using Microsoft.AspNetCore.Mvc;
using MonteCarloSimulatorAPI.Models;

namespace MonteCarloSimulatorAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SimulationController : ControllerBase
    {
        [HttpPost("price-option")]
        public ActionResult<SimulationResult> PriceOption([FromBody] OptionParameters parameters)
        {
            // Validate inputs
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            // Create the appropriate option type
            Option option;
            switch (parameters.OptionType)
            {
                case 1:
                    option = new EuropeanOption(parameters.StrikePrice, parameters.IsCall);
                    break;
                case 2:
                    option = new AsianOption(parameters.StrikePrice, parameters.IsCall);
                    break;
                case 3:
                    option = new DigitalOption(parameters.StrikePrice, parameters.IsCall, parameters.Rebate);
                    break;
                case 4:
                    BarrierType barrierType = (BarrierType)parameters.BarrierType;
                    option = new BarrierOption(parameters.StrikePrice, parameters.IsCall, parameters.Barrier, barrierType); 
                    //'parameters.Barrier' is the barrier level
                    break;
                case 5:
                    option = new LookbackOption(parameters.StrikePrice, parameters.IsCall);
                    break;
                case 6:
                    option = new RangeOption(parameters.StrikePrice, parameters.IsCall);
                    break;
                default:
                    return BadRequest("Invalid option type.");
            }

            // Generate random numbers
            double[,] randomNumbers;
            if (parameters.UseVDCSequence)
            {
                randomNumbers = new VanDerCorputGenerator(
                    parameters.Simulations,
                    parameters.Steps,
                    (int)parameters.Base1,
                    (int)parameters.Base2
                ).RandomNumbers;
            }
            else
            {
                randomNumbers = new RandomNumberGenerator(
                    parameters.Simulations,
                    parameters.Steps,
                    parameters.Antithetic
                ).RandomNumbers;
            }

            // Run simulation
            var results = GreeksCalculator.CalculateOptionPriceAndGreeks(
                option,
                parameters.StockPrice,
                parameters.RiskFreeRate,
                parameters.Volatility,
                parameters.TimeToMaturity,
                parameters.Steps,
                parameters.Simulations,
                randomNumbers,
                parameters.Antithetic,
                parameters.ControlVariate,
                parameters.Multithreaded
            );

            // Map results
            var simulationResult = new SimulationResult
            {
                Price = results.Item1,
                StandardError = results.Item2,
                Delta = results.Item3,
                Gamma = results.Item4,
                Vega = results.Item5,
                Theta = results.Item6,
                Rho = results.Item7
            };

            return Ok(simulationResult);
        }
    }
}
