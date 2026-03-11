using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Data;
using MonteCarloSimulatorAPI.Models;
using MonteCarloSimulatorAPI.Dtos;
using System;
using System.Collections.Generic;
using System.Linq;


namespace MonteCarloSimulatorAPI.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class UnderlyingsController : ControllerBase
    {
        private readonly ApplicationDbContext _context;

        public UnderlyingsController(ApplicationDbContext context)
        {
            _context = context;
        }

        // GET: api/Underlyings
        [HttpGet]
        public async Task<ActionResult<IEnumerable<Underlying>>> GetUnderlyings()
        {
            var underlyings = await _context.Underlyings
                .AsNoTracking()
                .OrderBy(u => u.Id)
                .Include(u => u.HistoricalPrices)
                .ToListAsync();

            foreach (var u in underlyings)
            {
                if (u.HistoricalPrices != null)
                {
                    u.HistoricalPrices = u.HistoricalPrices
                        .OrderBy(hp => hp.Date)
                        .ToList();
                }
            }

            return underlyings;
        }

        // GET: api/Underlyings/5 | Retrival only based on 'Id' + historical data!
        [HttpGet("{id}")]
        public async Task<ActionResult<Underlying>> GetUnderlying(int id)
        {
            var underlying = await _context.Underlyings
                .AsNoTracking()
                .Include(u => u.HistoricalPrices)
                .FirstOrDefaultAsync(u => u.Id == id);

            if (underlying == null)
            {
                return NotFound();
            }

            if (underlying.HistoricalPrices != null)
            {
                underlying.HistoricalPrices = underlying.HistoricalPrices
                    .OrderBy(hp => hp.Date)
                    .ToList();
            }

            return underlying;
        }


        // POST: api/Underlyings
        [HttpPost]
        public async Task<ActionResult<Underlying>> PostUnderlying(Underlying underlying)
        {
            _context.Underlyings.Add(underlying);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetUnderlying), new { id = underlying.Id }, underlying);
        }

        // PUT: api/Underlyings/5
        [HttpPut("{id}")]
        public async Task<IActionResult> PutUnderlying(int id, Underlying underlying)
        {
            if (id != underlying.Id)
            {
                return BadRequest();
            }

            _context.Entry(underlying).State = EntityState.Modified;

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                if (!UnderlyingExists(id))
                {
                    return NotFound();
                }
                else
                {
                    throw;
                }
            }

            return NoContent();
        }

        // DELETE: api/Underlyings/5
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteUnderlying(int id)
        {
            var underlying = await _context.Underlyings.FindAsync(id);
            if (underlying == null)
            {
                return NotFound();
            }

            _context.Underlyings.Remove(underlying);
            await _context.SaveChangesAsync();

            return NoContent();
        }
        // POST: api/Underlyings/HistoricalPrices/UpsertBySymbol
        // Body: [{ "symbol": "AAPL", "date": "2026-02-08", "price": 189.12 }, ...]
        [HttpPost("HistoricalPrices/UpsertBySymbol")]
        public async Task<IActionResult> UpsertHistoricalPricesBySymbol([FromBody] List<HistoricalPriceUpsertDto> prices)
        {
            var authResult = RejectIfIngestUnauthorized();
            if (authResult != null)
            {
                return authResult;
            }

            if (prices == null || prices.Count == 0)
            {
                return BadRequest("Body must be a non-empty JSON array.");
            }

            await using var tx = await _context.Database.BeginTransactionAsync();

            var normalized = prices
                .Select(p => new
                {
                    Symbol = (p.Symbol ?? string.Empty).Trim().ToUpperInvariant(),
                    Date = DateTime.SpecifyKind(p.Date.Date, DateTimeKind.Utc),
                    Price = p.Price
                })
                .Where(x => !string.IsNullOrWhiteSpace(x.Symbol))
                .ToList();

            if (normalized.Count == 0)
            {
                return BadRequest("No valid rows found. Each row requires a non-empty symbol.");
            }

            var symbols = normalized
                .Select(x => x.Symbol)
                .Distinct()
                .ToList();

            var existingUnderlyings = await _context.Underlyings
                .Where(u => symbols.Contains(u.Symbol))
                .ToListAsync();

            var underlyingsBySymbol = existingUnderlyings
                .ToDictionary(u => u.Symbol, u => u);

            foreach (var sym in symbols)
            {
                if (!underlyingsBySymbol.ContainsKey(sym))
                {
                    var u = new Underlying
                    {
                        Symbol = sym,
                        Name = sym
                    };

                    _context.Underlyings.Add(u);
                    underlyingsBySymbol[sym] = u;
                }
            }

            await _context.SaveChangesAsync();

            var targetUnderlyingIds = underlyingsBySymbol
                .Values
                .Select(u => u.Id)
                .Distinct()
                .ToList();

            var targetDates = normalized
                .Select(x => x.Date)
                .Distinct()
                .ToList();

            var existingPrices = await _context.HistoricalPrices
                .Where(hp => targetUnderlyingIds.Contains(hp.UnderlyingId) && targetDates.Contains(hp.Date))
                .ToListAsync();

            var existingGroups = existingPrices
                .GroupBy(hp => (hp.UnderlyingId, hp.Date))
                .ToDictionary(g => g.Key, g => g.ToList());

            var inserted = 0;
            var updated = 0;
            var deletedDuplicates = 0;

            foreach (var row in normalized)
            {
                var u = underlyingsBySymbol[row.Symbol];
                var key = (u.Id, row.Date);

                if (existingGroups.TryGetValue(key, out var group))
                {
                    var keeper = group[0];
                    keeper.Price = row.Price;

                    _context.HistoricalPrices.Update(keeper);
                    updated++;

                    if (group.Count > 1)
                    {
                        var extras = group.Skip(1).ToList();
                        _context.HistoricalPrices.RemoveRange(extras);
                        deletedDuplicates += extras.Count;
                    }
                }
                else
                {
                    _context.HistoricalPrices.Add(new HistoricalPrice
                    {
                        UnderlyingId = u.Id,
                        Date = row.Date,
                        Price = row.Price
                    });
                    inserted++;
                }
            }

            await _context.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new
            {
                rowsReceived = prices.Count,
                rowsProcessed = normalized.Count,
                symbols = symbols.Count,
                inserted,
                updated,
                deletedDuplicates
            });
        }

        private IActionResult? RejectIfIngestUnauthorized()
        {
            var expectedKey = Environment.GetEnvironmentVariable("DPP_INGEST_KEY");

            if (string.IsNullOrWhiteSpace(expectedKey))
            {
                return StatusCode(500, "DPP_INGEST_KEY is not configured on the API container.");
            }

            if (!Request.Headers.TryGetValue("X-DPP-INGEST-KEY", out var providedKey))
            {
                return Unauthorized("Missing X-DPP-INGEST-KEY header.");
            }

            if (providedKey != expectedKey)
            {
                return Unauthorized("Invalid X-DPP-INGEST-KEY.");
            }

            return null;
        }

        private bool UnderlyingExists(int id)
        {
            return _context.Underlyings.Any(e => e.Id == id);
        }
    }
}

