using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Data;
using MonteCarloSimulatorAPI.Models;

namespace MonteCarloSimulatorAPI.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class TradesController : ControllerBase
    {
        private readonly ApplicationDbContext _context;

        public TradesController(ApplicationDbContext context)
        {
            _context = context;
        }

        // GET: api/Trades
        [HttpGet]
        public async Task<ActionResult<IEnumerable<Trade>>> GetTrades()
        {
            return await _context.Trades
                .Include(t => t.Instrument)
                .ToListAsync();
        }

        // GET: api/Trades/5
        [HttpGet("{id}")]
        public async Task<ActionResult<Trade>> GetTrade(int id)
        {
            var trade = await _context.Trades
                .Include(t => t.Instrument)
                .FirstOrDefaultAsync(t => t.Id == id);

            if (trade == null)
            {
                return NotFound();
            }

            return trade;
        }

        // POST: api/Trades
        [HttpPost]
        public async Task<ActionResult<Trade>> PostTrade(Trade trade)
        {
            _context.Trades.Add(trade);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetTrade), new { id = trade.Id }, trade);
        }

        // PUT: api/Trades/5
        [HttpPut("{id}")]
        public async Task<IActionResult> PutTrade(int id, Trade trade)
        {
            if (id != trade.Id)
            {
                return BadRequest();
            }

            _context.Entry(trade).State = EntityState.Modified;

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                if (!TradeExists(id))
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

        // DELETE: api/Trades/5
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteTrade(int id)
        {
            var trade = await _context.Trades.FindAsync(id);
            if (trade == null)
            {
                return NotFound();
            }

            _context.Trades.Remove(trade);
            await _context.SaveChangesAsync();

            return NoContent();
        }

        private bool TradeExists(int id)
        {
            return _context.Trades.Any(e => e.Id == id);
        }
    }
}