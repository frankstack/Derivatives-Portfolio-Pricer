using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Data;
using MonteCarloSimulatorAPI.Models;

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
            return await _context.Underlyings
                .Include(u => u.HistoricalPrices)
                .ToListAsync();
        }

        // GET: api/Underlyings/5 | Retrival only based on 'Id' + historical data!
        [HttpGet("{id}")]
        public async Task<ActionResult<Underlying>> GetUnderlying(int id)
        {
            var underlying = await _context.Underlyings
                .Include(u => u.HistoricalPrices)
                .FirstOrDefaultAsync(u => u.Id == id);

            if (underlying == null)
            {
                return NotFound();
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

        private bool UnderlyingExists(int id)
        {
            return _context.Underlyings.Any(e => e.Id == id);
        }
    }
}