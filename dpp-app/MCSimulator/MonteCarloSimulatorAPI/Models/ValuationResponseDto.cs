using System.Collections.Generic;

namespace MonteCarloSimulatorAPI.Models
{
    public class ValuationResponseDto
    {
        public List<TradeValuationDto> Valuations { get; set; } = new List<TradeValuationDto>();
        public double PortfolioValue { get; set; }

        // The date the book was valued at (the request's ValuationDate, or the time of the call)
        public DateTime ValuationDate { get; set; }
    }
}
