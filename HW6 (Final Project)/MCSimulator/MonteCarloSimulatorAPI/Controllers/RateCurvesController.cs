using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Data;
using MonteCarloSimulatorAPI.Models;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace MonteCarloSimulatorAPI.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class RateCurvesController : ControllerBase
    {
        private readonly ApplicationDbContext _context;

        public RateCurvesController(ApplicationDbContext context)
        {
            _context = context;
        }

        // GET: api/RateCurves
        [HttpGet]
        public async Task<ActionResult<IEnumerable<RateCurve>>> GetRateCurves()
        {
            var curves = await _context.RateCurves
                .Include(rc => rc.RatePoints)
                .ToListAsync();
            return curves;
        }

        // POST: api/RateCurves
        [HttpPost]
        public async Task<ActionResult<RateCurve>> PostRateCurve([FromBody] RateCurve rateCurve)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            _context.RateCurves.Add(rateCurve);
            await _context.SaveChangesAsync();
            return CreatedAtAction(nameof(GetRateCurve), new { id = rateCurve.Id }, rateCurve);
        }

        // GET: api/RateCurves/{id}
        [HttpGet("{id}")]
        public async Task<ActionResult<RateCurve>> GetRateCurve(int id)
        {
            var curve = await _context.RateCurves
                .Include(rc => rc.RatePoints)
                .FirstOrDefaultAsync(rc => rc.Id == id);

            if (curve == null) return NotFound();

            return curve;
        }

        // PUT: api/RateCurves/{id}
        [HttpPut("{id}")]
        public async Task<IActionResult> PutRateCurve(int id, [FromBody] RateCurve rateCurve)
        {
            if (id != rateCurve.Id)
            {
                return BadRequest("ID mismatch.");
            }

            _context.Entry(rateCurve).State = EntityState.Modified;

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                if (!RateCurveExists(id))
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

        // POST: api/RateCurves/{rateCurveId}/RatePoints
        [HttpPost("{rateCurveId}/RatePoints")]
        public async Task<ActionResult<IEnumerable<RatePoint>>> PostRatePoints(int rateCurveId, [FromBody] List<RatePoint> ratePoints)
        {
            var curve = await _context.RateCurves.FindAsync(rateCurveId);
            if (curve == null)
            {
                return BadRequest("RateCurve not found.");
            }

            foreach (var rp in ratePoints)
            {
                rp.RateCurveId = rateCurveId;
                _context.RatePoints.Add(rp);
            }

            await _context.SaveChangesAsync();
            return Ok(ratePoints);
        }

        // DELETE: api/RateCurves/{id}
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteRateCurve(int id)
        {
            var curve = await _context.RateCurves.FindAsync(id);
            if (curve == null)
            {
                return NotFound();
            }

            _context.RateCurves.Remove(curve);
            await _context.SaveChangesAsync();

            return NoContent();
        }

        private bool RateCurveExists(int id)
        {
            return _context.RateCurves.Any(e => e.Id == id);
        }
    }
}
