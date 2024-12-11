using System.Collections.Generic;

namespace MonteCarloSimulatorAPI.Models
{
    public class ValuationResponseDto
    {
        public List<TradeValuationDto> Valuations { get; set; } = new List<TradeValuationDto>();
    }
}
