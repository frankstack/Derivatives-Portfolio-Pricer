using System;
using System.ComponentModel.DataAnnotations;

namespace MonteCarloSimulatorAPI.Models
{
    public class TradeValuationDto
    {
        public int TradeId { get; set; }
        [Required]
        public required string InstrumentSymbol { get; set; }
        [Required]
        public required string InstrumentName { get; set; }
        public double Price { get; set; }
        public double StandardError { get; set; }
        public double Delta { get; set; }
        public double Gamma { get; set; }
        public double Vega { get; set; }
        public double Theta { get; set; }
        public double Rho { get; set; }
        
        // New fields for displaying volatility and interest rate used in the valuation
        public double Volatility { get; set; }
        public double RiskFreeRate { get; set; }
    }
}
