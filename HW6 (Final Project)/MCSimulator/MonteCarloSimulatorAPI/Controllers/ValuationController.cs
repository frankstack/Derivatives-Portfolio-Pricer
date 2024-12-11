using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Data;
using MonteCarloSimulatorAPI.Models;
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace MonteCarloSimulatorAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ValuationController : ControllerBase
    {
        private readonly ApplicationDbContext _context;

        public ValuationController(ApplicationDbContext context)
        {
            _context = context;
        }

        [HttpPost]
        [ProducesResponseType(typeof(ValuationResponseDto), 200)]
        [ProducesResponseType(400)]
        public async Task<ActionResult<ValuationResponseDto>> PostValuation([FromBody] ValuationRequestDto request)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            // Retrieve trades based on the provided TradeIds
            var trades = await _context.Trades
                .Include(t => t.Instrument)
                .ToListAsync();

            // Filter only requested trades
            var requestedTrades = trades.Where(t => request.TradeIds.Contains(t.Id)).ToList();

            if (requestedTrades.Count != request.TradeIds.Count)
            {
                var foundIds = requestedTrades.Select(t => t.Id).ToHashSet();
                var missingIds = request.TradeIds.Where(id => !foundIds.Contains(id)).ToList();
                return BadRequest($"Some trades not found: {string.Join(", ", missingIds)}");
            }

            // Retrieve the selected RateCurve
            var selectedCurve = await _context.RateCurves
                .Include(rc => rc.RatePoints)
                .FirstOrDefaultAsync(rc => rc.Id == request.RateCurveId);

            if (selectedCurve == null || selectedCurve.RatePoints == null || !selectedCurve.RatePoints.Any())
            {
                return BadRequest("Selected RateCurve not found or has no RatePoints.");
            }

            var response = new ValuationResponseDto();

            // Extract user-defined parameters
            int steps = request.Steps;
            int simulations = request.Simulations;
            bool antithetic = request.Antithetic;
            bool controlVariate = request.ControlVariate;
            bool multithreaded = request.Multithreaded;
            bool useVDC = request.UseVDCSequence;
            int base1 = request.Base1;
            int base2 = request.Base2;

            foreach (var trade in requestedTrades)
            {
                var instrument = trade.Instrument;
                if (instrument == null)
                {
                    return BadRequest($"Instrument not found for trade {trade.Id}");
                }

                var tradeValuation = new TradeValuationDto
                {
                    TradeId = trade.Id,
                    InstrumentSymbol = instrument.Symbol,
                    InstrumentName = instrument.Name
                };

                // If instrument is an Underlying
                if (instrument is Underlying underInstr)
                {
                    double? latestPrice = await GetLatestUnderlyingPrice(underInstr.Id);
                    if (latestPrice == null)
                    {
                        return BadRequest($"No price data available for underlying {underInstr.Id}");
                    }

                    // Underlying valuation as simple: Price = latest * quantity, Delta=1, no others
                    tradeValuation.Price = latestPrice.Value * trade.Quantity;
                    tradeValuation.StandardError = 0;
                    tradeValuation.Delta = 1;
                    tradeValuation.Gamma = 0;
                    tradeValuation.Vega = 0;
                    tradeValuation.Theta = 0;
                    tradeValuation.Rho = 0;

                    // No volatility or rate needed for an underlying direct value
                    tradeValuation.Volatility = 0.0;
                    tradeValuation.RiskFreeRate = 0.0;
                }
                else if (instrument is OptionEntity optionEntity)
                {
                    var optionUnderlying = await _context.Underlyings.FindAsync(optionEntity.UnderlyingId);
                    if (optionUnderlying == null)
                    {
                        return BadRequest($"Option {optionEntity.Id} references an invalid underlying {optionEntity.UnderlyingId}");
                    }

                    double? latestPrice = await GetLatestUnderlyingPrice(optionUnderlying.Id);
                    if (latestPrice == null)
                    {
                        return BadRequest($"No price data available for underlying {optionUnderlying.Id}");
                    }

                    double? volatility = await CalculateVolatility(optionUnderlying.Id);
                    if (volatility == null)
                    {
                        return BadRequest($"Could not calculate volatility for underlying {optionUnderlying.Id}");
                    }

                    // Compute time-to-maturity based on TradeDate and ExpirationDate
                    double daysToMaturity = (optionEntity.ExpirationDate - trade.TradeDate).TotalDays;
                    double ttm = daysToMaturity / 365.0;
                    if (ttm <= 0)
                    {
                        // Option expired
                        tradeValuation.Price = 0;
                        tradeValuation.StandardError = 0;
                        tradeValuation.Delta = 0;
                        tradeValuation.Gamma = 0;
                        tradeValuation.Vega = 0;
                        tradeValuation.Theta = 0;
                        tradeValuation.Rho = 0;
                        // Even expired, we know volatility and we must find rate
                        double? expiredRiskFree = GetRiskFreeRateFromCurve(selectedCurve, 1.0); // If expired, just pick 1 year or 0.0...
                        if (expiredRiskFree == null) expiredRiskFree = 0.0;
                        tradeValuation.Volatility = volatility.Value;
                        tradeValuation.RiskFreeRate = expiredRiskFree.Value;

                        response.Valuations.Add(tradeValuation);
                        continue;
                    }

                    double? riskFreeRate = GetRiskFreeRateFromCurve(selectedCurve, ttm);
                    if (riskFreeRate == null)
                    {
                        return BadRequest("Could not retrieve a suitable rate from the selected RateCurve for the given maturity.");
                    }

                    bool isCall = optionEntity.IsCall;

                    Option option = MapOptionEntityToOption(
                        optionEntity,
                        isCall,
                        optionEntity.OptionStyle,
                        optionEntity.StrikePrice,
                        optionEntity.ExpirationDate,
                        optionEntity is BarrierOptionEntity ? ((BarrierOptionEntity)optionEntity).BarrierLevel : 1.0,
                        optionEntity is BarrierOptionEntity ? ((BarrierOptionEntity)optionEntity).BarrierType : 1,
                        optionEntity is DigitalOptionEntity ? ((DigitalOptionEntity)optionEntity).Rebate : 0.0
                    );

                    double[,] randomNumbers = GenerateRandomNumbers(simulations, steps, antithetic, useVDC, base1, base2);

                    var results = GreeksCalculator.CalculateOptionPriceAndGreeks(
                        option,
                        latestPrice.Value, 
                        riskFreeRate.Value,
                        volatility.Value,
                        ttm,
                        steps,
                        simulations,
                        randomNumbers,
                        antithetic,
                        controlVariate,
                        multithreaded
                    );

                    tradeValuation.Price = results.Item1 * trade.Quantity; // Price Returned is the total value, considering Quantity!
                    tradeValuation.StandardError = results.Item2;
                    tradeValuation.Delta = results.Item3;
                    tradeValuation.Gamma = results.Item4;
                    tradeValuation.Vega = results.Item5;
                    tradeValuation.Theta = results.Item6;
                    tradeValuation.Rho = results.Item7;

                    // Assign new fields for option valuations
                    tradeValuation.Volatility = volatility.Value;
                    tradeValuation.RiskFreeRate = riskFreeRate.Value;
                }
                else
                {
                    return BadRequest($"Instrument type not supported for trade {trade.Id}");
                }

                response.Valuations.Add(tradeValuation);
            }

            return Ok(response);
        }

        private async Task<double?> GetLatestUnderlyingPrice(int underlyingId)
        {
            var price = await _context.HistoricalPrices
                .Where(hp => hp.UnderlyingId == underlyingId)
                .OrderByDescending(hp => hp.Date)
                .Select(hp => hp.Price)
                .FirstOrDefaultAsync();

            if (price == 0)
            {
                var count = await _context.HistoricalPrices.Where(hp => hp.UnderlyingId == underlyingId).CountAsync();
                if (count == 0) return null;
            }

            return price;
        }

        private async Task<double?> CalculateVolatility(int underlyingId)
        {
            var prices = await _context.HistoricalPrices
                .Where(hp => hp.UnderlyingId == underlyingId)
                .OrderBy(hp => hp.Date)
                .Select(hp => hp.Price)
                .ToListAsync();

            if (prices.Count < 2) return null;

            var logReturns = new List<double>();
            for (int i = 1; i < prices.Count; i++)
            {
                if (prices[i - 1] <= 0) return null;
                double r = Math.Log(prices[i] / prices[i - 1]);
                logReturns.Add(r);
            }

            double mean = logReturns.Average();
            double variance = logReturns.Select(r => Math.Pow(r - mean, 2)).Sum() / (logReturns.Count - 1);
            double stdDev = Math.Sqrt(variance);

            return stdDev * Math.Sqrt(252);
        }

        // Removed old GetRiskFreeRate, we now rely on chosen curve & tenor
        private double? GetRiskFreeRateFromCurve(RateCurve curve, double timeToMaturity)
        {
            if (curve.RatePoints == null || !curve.RatePoints.Any())
                return null;

            var bestPoint = curve.RatePoints
                .OrderBy(rp => Math.Abs(rp.Tenor - timeToMaturity))
                .FirstOrDefault();

            if (bestPoint == null) return null;
            return bestPoint.Rate;
        }

        private Option MapOptionEntityToOption(
            OptionEntity optionEntity,
            bool isCall,
            int optionStyle,
            double strikePrice,
            DateTime expiration,
            double barrier,
            int barrierType,
            double rebate)
        {
            switch (optionStyle)
            {
                case 1:
                    return new EuropeanOption(strikePrice, isCall);
                case 2:
                    return new AsianOption(strikePrice, isCall);
                case 3:
                    return new DigitalOption(strikePrice, isCall, rebate);
                case 4:
                    var bType = (BarrierType)(barrierType - 1);
                    return new BarrierOption(strikePrice, isCall, barrier, bType);
                case 5:
                    return new LookbackOption(strikePrice, isCall);
                case 6:
                    return new RangeOption(strikePrice, isCall);
                default:
                    throw new Exception("Unsupported option style.");
            }
        }

        private double[,] GenerateRandomNumbers(int simulations, int steps, bool antithetic, bool useVDC, int base1, int base2)
        {
            if (useVDC)
            {
                return new VanDerCorputGenerator(simulations, steps, base1, base2).RandomNumbers;
            }
            else
            {
                return new RandomNumberGenerator(simulations, steps, antithetic).RandomNumbers;
            }
        }
    }
}
