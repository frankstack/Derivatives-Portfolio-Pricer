using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Data;
using MonteCarloSimulatorAPI.Models;

namespace MonteCarloSimulatorAPI.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class OptionEntitiesController : ControllerBase
    {
        private readonly ApplicationDbContext _context;

        public OptionEntitiesController(ApplicationDbContext context)
        {
            _context = context;
        }

        // GET: api/OptionEntities
        [HttpGet]
        public async Task<ActionResult<IEnumerable<OptionEntity>>> GetOptionEntities()
        {
            return await _context.OptionEntities
                .Include(o => o.Underlying)
                    .ThenInclude(u => u!.HistoricalPrices)
                .ToListAsync();
        }

        // GET: api/OptionEntities/5
        [HttpGet("{id}")]
        public async Task<ActionResult<OptionEntity>> GetOptionEntity(int id)
        {
            var optionEntity = await _context.OptionEntities
                .Include(o => o.Underlying)
                    .ThenInclude(u => u!.HistoricalPrices)
                .FirstOrDefaultAsync(o => o.Id == id);

            if (optionEntity == null)
            {
                return NotFound();
            }

            return optionEntity;
        }

        // POST: api/OptionEntities
        [HttpPost]
        public async Task<ActionResult<OptionEntity>> PostOptionEntity([FromBody] OptionEntityDto optionEntityDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            // Check if the underlying exists
            var underlying = await _context.Underlyings.FindAsync(optionEntityDto.UnderlyingId);
            if (underlying == null)
            {
                return BadRequest("Underlying asset not found.");
            }

            OptionEntity optionEntity;

            switch (optionEntityDto.OptionType)
            {
                case 1: // European Option
                    optionEntity = new EuropeanOptionEntity
                    {
                        Symbol = optionEntityDto.Symbol,
                        Name = optionEntityDto.Name,
                        StrikePrice = optionEntityDto.StrikePrice,
                        ExpirationDate = optionEntityDto.ExpirationDate,
                        OptionStyle = optionEntityDto.OptionStyle,
                        IsCall = optionEntityDto.IsCall,
                        UnderlyingId = optionEntityDto.UnderlyingId
                    };
                    break;
                case 2: // Asian Option
                    optionEntity = new AsianOptionEntity
                    {
                        Symbol = optionEntityDto.Symbol,
                        Name = optionEntityDto.Name,
                        StrikePrice = optionEntityDto.StrikePrice,
                        ExpirationDate = optionEntityDto.ExpirationDate,
                        OptionStyle = optionEntityDto.OptionStyle,
                        IsCall = optionEntityDto.IsCall,
                        UnderlyingId = optionEntityDto.UnderlyingId
                    };
                    break;
                case 3: // Digital Option
                    optionEntity = new DigitalOptionEntity
                    {
                        Symbol = optionEntityDto.Symbol,
                        Name = optionEntityDto.Name,
                        StrikePrice = optionEntityDto.StrikePrice,
                        ExpirationDate = optionEntityDto.ExpirationDate,
                        OptionStyle = optionEntityDto.OptionStyle,
                        IsCall = optionEntityDto.IsCall,
                        Rebate = optionEntityDto.Rebate,
                        UnderlyingId = optionEntityDto.UnderlyingId
                    };
                    break;
                case 4: // Barrier Option
                    optionEntity = new BarrierOptionEntity
                    {
                        Symbol = optionEntityDto.Symbol,
                        Name = optionEntityDto.Name,
                        StrikePrice = optionEntityDto.StrikePrice,
                        ExpirationDate = optionEntityDto.ExpirationDate,
                        OptionStyle = optionEntityDto.OptionStyle,
                        IsCall = optionEntityDto.IsCall,
                        BarrierLevel = optionEntityDto.Barrier,
                        BarrierType = optionEntityDto.BarrierType,
                        UnderlyingId = optionEntityDto.UnderlyingId
                    };
                    break;
                case 5: // Lookback Option
                    optionEntity = new LookbackOptionEntity
                    {
                        Symbol = optionEntityDto.Symbol,
                        Name = optionEntityDto.Name,
                        StrikePrice = optionEntityDto.StrikePrice,
                        ExpirationDate = optionEntityDto.ExpirationDate,
                        OptionStyle = optionEntityDto.OptionStyle,
                        IsCall = optionEntityDto.IsCall,
                        UnderlyingId = optionEntityDto.UnderlyingId
                    };
                    break;
                case 6: // Range Option
                    optionEntity = new RangeOptionEntity
                    {
                        Symbol = optionEntityDto.Symbol,
                        Name = optionEntityDto.Name,
                        StrikePrice = optionEntityDto.StrikePrice,
                        ExpirationDate = optionEntityDto.ExpirationDate,
                        OptionStyle = optionEntityDto.OptionStyle,
                        IsCall = optionEntityDto.IsCall,
                        UnderlyingId = optionEntityDto.UnderlyingId
                    };
                    break;
                default:
                    return BadRequest("Invalid or unsupported option type.");
            }

            _context.OptionEntities.Add(optionEntity);
            await _context.SaveChangesAsync();

            // Re-fetch the saved optionEntity including Underlying and HistoricalPrices for next process
            optionEntity = (await _context.OptionEntities
                .Include(o => o.Underlying)
                    .ThenInclude(u => u!.HistoricalPrices)
                .FirstOrDefaultAsync(o => o.Id == optionEntity.Id))!;

            // Return line to use the null-forgiving operator on optionEntity
            return CreatedAtAction(nameof(GetOptionEntity), new { id = optionEntity!.Id }, optionEntity);

        }

        // PUT: api/OptionEntities/5
        [HttpPut("{id}")]
        public async Task<IActionResult> PutOptionEntity(int id, [FromBody] OptionEntityDto optionEntityDto)
        {
            if (id != optionEntityDto.Id)
            {
                return BadRequest("ID mismatch.");
            }

            var existingOptionEntity = await _context.OptionEntities.FindAsync(id);

            if (existingOptionEntity == null)
            {
                return NotFound();
            }

            // Update common properties
            existingOptionEntity.Symbol = optionEntityDto.Symbol;
            existingOptionEntity.Name = optionEntityDto.Name;
            existingOptionEntity.StrikePrice = optionEntityDto.StrikePrice;
            existingOptionEntity.ExpirationDate = optionEntityDto.ExpirationDate;
            existingOptionEntity.OptionStyle = optionEntityDto.OptionStyle;
            existingOptionEntity.IsCall = optionEntityDto.IsCall;
            existingOptionEntity.UnderlyingId = optionEntityDto.UnderlyingId;

            // Update specific properties based on option type
            switch (optionEntityDto.OptionType)
            {
                case 3: // Digital Option
                    if (existingOptionEntity is DigitalOptionEntity digitalOption)
                    {
                        digitalOption.Rebate = optionEntityDto.Rebate;
                    }
                    break;
                case 4: // Barrier Option
                    if (existingOptionEntity is BarrierOptionEntity barrierOption)
                    {
                        barrierOption.BarrierLevel = optionEntityDto.Barrier;
                        barrierOption.BarrierType = optionEntityDto.BarrierType;
                    }
                    break;
            }

            _context.Entry(existingOptionEntity).State = EntityState.Modified;

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                if (!OptionEntityExists(id))
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

        // DELETE: api/OptionEntities/5
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteOptionEntity(int id)
        {
            var optionEntity = await _context.OptionEntities.FindAsync(id);
            if (optionEntity == null)
            {
                return NotFound();
            }

            _context.OptionEntities.Remove(optionEntity);
            await _context.SaveChangesAsync();

            return NoContent();
        }

        private bool OptionEntityExists(int id)
        {
            return _context.OptionEntities.Any(e => e.Id == id);
        }
    }
}
