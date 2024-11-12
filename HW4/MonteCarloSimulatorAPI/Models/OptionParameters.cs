using System.ComponentModel.DataAnnotations;

namespace MonteCarloSimulatorAPI.Models
{
    public class OptionParameters
    {
        [Required]
        [Range(0.01, double.MaxValue, ErrorMessage = "Stock Price must be greater than zero.")]
        public double StockPrice { get; set; }

        [Required]
        [Range(0.01, double.MaxValue, ErrorMessage = "Strike Price must be greater than zero.")]
        public double StrikePrice { get; set; }

        [Required]
        public double RiskFreeRate { get; set; }

        [Required]
        [Range(0.0001, double.MaxValue, ErrorMessage = "Volatility must be greater than zero.")]
        public double Volatility { get; set; }

        [Required]
        [Range(0.0001, double.MaxValue, ErrorMessage = "Time to Maturity must be greater than zero.")]
        public double TimeToMaturity { get; set; }

        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "Steps must be a positive integer.")]
        public int Steps { get; set; }

        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "Simulations must be a positive integer.")]
        public int Simulations { get; set; }

        [Required]
        public bool IsCall { get; set; }

        public bool Antithetic { get; set; }
        public bool ControlVariate { get; set; }
        public bool Multithreaded { get; set; }

        [Required]
        [Range(1, 6, ErrorMessage = "Option Type must be between 1 and 6.")]
        public int OptionType { get; set; }

        public bool UseVDCSequence { get; set; }

        [Range(2, int.MaxValue, ErrorMessage = "Base1 must be greater than or equal to 2.")]
        public int Base1 { get; set; }

        [Range(2, int.MaxValue, ErrorMessage = "Base2 must be greater than or equal to 2.")]
        public int Base2 { get; set; }

        [Range(0.0, double.MaxValue, ErrorMessage = "Rebate must be non-negative.")]
        public double Rebate { get; set; }

        [Range(0.01, double.MaxValue, ErrorMessage = "Barrier must be greater than zero.")]
        public double Barrier { get; set; }

        [Range(1, 4, ErrorMessage = "Barrier Type must be between 1 and 4.")]
        public int BarrierType { get; set; }
    }
}
