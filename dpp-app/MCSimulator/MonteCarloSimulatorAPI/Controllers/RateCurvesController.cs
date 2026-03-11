using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Data;
using MonteCarloSimulatorAPI.Models;
using MonteCarloSimulatorAPI.Dtos;
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


        // PUT: api/RateCurves/{rateCurveId}/RatePoints/Replace
        // Body: [{ "tenor": 0.25, "rate": 0.0475 }, ...]
        [HttpPut("{rateCurveId}/RatePoints/Replace")]
        public async Task<IActionResult> ReplaceRatePointsById(int rateCurveId, [FromBody] List<RatePointUpsertDto> ratePoints)
        {
            var authResult = RejectIfIngestUnauthorized();
            if (authResult != null)
            {
                return authResult;
            }

            if (ratePoints == null || ratePoints.Count == 0)
            {
                return BadRequest("Body must be a non-empty JSON array.");
            }

            var curve = await _context.RateCurves.FirstOrDefaultAsync(rc => rc.Id == rateCurveId);
            if (curve == null)
            {
                return BadRequest("RateCurve not found.");
            }

            await using var tx = await _context.Database.BeginTransactionAsync();

            var existing = await _context.RatePoints
                .Where(rp => rp.RateCurveId == curve.Id)
                .ToListAsync();

            _context.RatePoints.RemoveRange(existing);

            foreach (var rp in ratePoints)
            {
                _context.RatePoints.Add(new RatePoint
                {
                    RateCurveId = curve.Id,
                    Tenor = rp.Tenor,
                    Rate = rp.Rate
                });
            }

            await _context.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new
            {
                curveId = curve.Id,
                curveName = curve.Name,
                removed = existing.Count,
                inserted = ratePoints.Count
            });
        }

        // PUT: api/RateCurves/ByName/{curveName}/RatePoints/Replace
        // Body: [{ "tenor": 0.25, "rate": 0.0475 }, ...]
        [HttpPut("ByName/{curveName}/RatePoints/Replace")]
        public async Task<IActionResult> ReplaceRatePointsByName(string curveName, [FromBody] List<RatePointUpsertDto> ratePoints)
        {
            var authResult = RejectIfIngestUnauthorized();
            if (authResult != null)
            {
                return authResult;
            }

            curveName = (curveName ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(curveName))
            {
                return BadRequest("curveName is required.");
            }

            if (ratePoints == null || ratePoints.Count == 0)
            {
                return BadRequest("Body must be a non-empty JSON array.");
            }

            await using var tx = await _context.Database.BeginTransactionAsync();

            var curve = await _context.RateCurves.FirstOrDefaultAsync(rc => rc.Name == curveName);
            if (curve == null)
            {
                curve = new RateCurve { Name = curveName };
                _context.RateCurves.Add(curve);
                await _context.SaveChangesAsync();
            }

            var existing = await _context.RatePoints
                .Where(rp => rp.RateCurveId == curve.Id)
                .ToListAsync();

            _context.RatePoints.RemoveRange(existing);

            foreach (var rp in ratePoints)
            {
                _context.RatePoints.Add(new RatePoint
                {
                    RateCurveId = curve.Id,
                    Tenor = rp.Tenor,
                    Rate = rp.Rate
                });
            }

            await _context.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new
            {
                curveId = curve.Id,
                curveName = curve.Name,
                removed = existing.Count,
                inserted = ratePoints.Count
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
