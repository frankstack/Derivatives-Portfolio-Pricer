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

        // Position context. Price is the position value (UnitPrice times Quantity); the Greeks are per unit.
        public int Quantity { get; set; }
        public double UnitPrice { get; set; }

        // What the valuation was computed from
        public double Spot { get; set; }
        public DateTime? SpotDate { get; set; }
        public double TimeToMaturity { get; set; } // Years left at the valuation date

        // "valued", "expired" (nothing left to value) or "not_traded_yet" (traded after the valuation date)
        public string Status { get; set; } = "valued";
    }
}
