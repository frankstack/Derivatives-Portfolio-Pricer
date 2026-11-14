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

        // One close of an underlying. Closes are stored at 00:00 UTC of their session date.
        private readonly record struct PricePoint(DateTime Date, double Price);

        [HttpPost]
        [ProducesResponseType(typeof(ValuationResponseDto), 200)]
        [ProducesResponseType(400)]
        public async Task<ActionResult<ValuationResponseDto>> PostValuation([FromBody] ValuationRequestDto request)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            // The valuation date is the moment the book is valued at. Time to expiry is counted
            // from it and only closes on or before it are used. Without one in the request the
            // book is valued as of now.
            bool asOfRequested = request.ValuationDate.HasValue;
            DateTime valuationDate = asOfRequested ? ToUtc(request.ValuationDate!.Value) : DateTime.UtcNow;

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

            var response = new ValuationResponseDto { ValuationDate = valuationDate };

            // Price history per underlying, loaded once per request
            var historyCache = new Dictionary<int, List<PricePoint>>();

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
                    InstrumentName = instrument.Name,
                    Quantity = trade.Quantity,
                    Status = "valued"
                };

                // Valuing a past date: a trade done after that date was not in the book yet.
                if (asOfRequested && ToUtc(trade.TradeDate).Date > valuationDate.Date)
                {
                    tradeValuation.Status = "not_traded_yet";
                    response.Valuations.Add(tradeValuation);
                    continue;
                }

                // If instrument is an Underlying
                if (instrument is Underlying underInstr)
                {
                    var history = await GetPriceHistory(underInstr.Id, valuationDate, historyCache);
                    if (history.Count == 0)
                    {
                        return BadRequest($"No price data available for underlying {underInstr.Id} on or before {valuationDate:yyyy-MM-dd}");
                    }

                    var spot = history[history.Count - 1];

                    // Underlying valuation as simple: Price = latest * quantity, Delta=1, no others
                    tradeValuation.Spot = spot.Price;
                    tradeValuation.SpotDate = spot.Date;
                    tradeValuation.UnitPrice = spot.Price;
                    tradeValuation.Price = spot.Price * trade.Quantity;
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
                    var history = await GetPriceHistory(optionEntity.UnderlyingId, valuationDate, historyCache);
                    if (history.Count == 0)
                    {
                        return BadRequest($"No price data available for underlying {optionEntity.UnderlyingId} on or before {valuationDate:yyyy-MM-dd}");
                    }

                    var spot = history[history.Count - 1];

                    double? volatility = CalculateVolatility(history);
                    if (volatility == null)
                    {
                        return BadRequest($"Could not calculate volatility for underlying {optionEntity.UnderlyingId}: it needs at least three positive closes on or before {valuationDate:yyyy-MM-dd}");
                    }

                    tradeValuation.Spot = spot.Price;
                    tradeValuation.SpotDate = spot.Date;
                    tradeValuation.Volatility = volatility.Value;

                    // Time to expiry runs from the valuation date, so a trade done months ago is
                    // valued with the life the option has left, not the life it had when traded.
                    double ttm = (ToUtc(optionEntity.ExpirationDate) - valuationDate).TotalDays / 365.0;
                    tradeValuation.TimeToMaturity = Math.Max(ttm, 0.0);

                    if (ttm <= 0)
                    {
                        // Expired: there is no position left to value
                        tradeValuation.Status = "expired";
                        tradeValuation.RiskFreeRate = GetRiskFreeRateFromCurve(selectedCurve, 1.0) ?? 0.0;

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
                        spot.Price,
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

                    tradeValuation.UnitPrice = results.Item1;
                    tradeValuation.Price = results.Item1 * trade.Quantity; // Price Returned is the total value, considering Quantity!
                    tradeValuation.StandardError = results.Item2;
                    tradeValuation.Delta = results.Item3;
                    tradeValuation.Gamma = results.Item4;
                    tradeValuation.Vega = results.Item5;
                    tradeValuation.Theta = results.Item6;
                    tradeValuation.Rho = results.Item7;

                    tradeValuation.RiskFreeRate = riskFreeRate.Value;
                }
                else
                {
                    return BadRequest($"Instrument type not supported for trade {trade.Id}");
                }

                response.Valuations.Add(tradeValuation);
            }

            response.PortfolioValue = response.Valuations.Sum(v => v.Price);

            return Ok(response);
        }

        // Dates arrive from JSON with or without a zone and from Postgres as UTC. Treat a date
        // without a zone as UTC so every comparison below is on the same clock.
        private static DateTime ToUtc(DateTime value)
        {
            if (value.Kind == DateTimeKind.Utc) return value;
            if (value.Kind == DateTimeKind.Local) return value.ToUniversalTime();
            return DateTime.SpecifyKind(value, DateTimeKind.Utc);
        }

        // Closes of one underlying on or before the valuation date, oldest first
        private async Task<List<PricePoint>> GetPriceHistory(int underlyingId, DateTime valuationDate, Dictionary<int, List<PricePoint>> cache)
        {
            if (cache.TryGetValue(underlyingId, out var cached))
            {
                return cached;
            }

            var rows = await _context.HistoricalPrices
                .Where(hp => hp.UnderlyingId == underlyingId)
                .OrderBy(hp => hp.Date)
                .Select(hp => new { hp.Date, hp.Price })
                .ToListAsync();

            var history = rows
                .Select(r => new PricePoint(ToUtc(r.Date), r.Price))
                .Where(p => p.Date <= valuationDate)
                .ToList();

            cache[underlyingId] = history;
            return history;
        }

        // Annualized volatility of the daily log returns over the closes given
        private static double? CalculateVolatility(List<PricePoint> history)
        {
            // Two returns are the minimum for a sample standard deviation
            if (history.Count < 3) return null;

            var logReturns = new List<double>(history.Count - 1);
            for (int i = 1; i < history.Count; i++)
            {
                if (history[i - 1].Price <= 0 || history[i].Price <= 0) return null;
                logReturns.Add(Math.Log(history[i].Price / history[i - 1].Price));
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
