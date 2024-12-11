using System.ComponentModel.DataAnnotations;
using Swashbuckle.AspNetCore.Annotations;
using System.ComponentModel; // Added for DefaultValue attribute

namespace MonteCarloSimulatorAPI.Models
{
    public class OptionParameters
    {
        [Required]
        [Range(0.01, double.MaxValue, ErrorMessage = "Stock Price must be greater than zero.")]
        [SwaggerSchema(Description = "Current stock price")]
        [DefaultValue(100.0)]
        public double StockPrice { get; set; }

        [Required]
        [Range(0.01, double.MaxValue, ErrorMessage = "Strike Price must be greater than zero.")]
        [SwaggerSchema(Description = "Option's strike price")]
        [DefaultValue(100.0)]
        public double StrikePrice { get; set; }

        [Required]
        [SwaggerSchema(Description = "Risk-free interest rate (e.g., 0.05 for 5%)")]
        [DefaultValue(0.05)]
        public double RiskFreeRate { get; set; }

        [Required]
        [Range(0.0001, double.MaxValue, ErrorMessage = "Volatility must be greater than zero.")]
        [SwaggerSchema(Description = "Volatility of the underlying asset (e.g., 0.2 for 20%)")]
        [DefaultValue(0.2)]
        public double Volatility { get; set; }

        [Required]
        [Range(0.0001, double.MaxValue, ErrorMessage = "Time to Maturity must be greater than zero.")]
        [SwaggerSchema(Description = "Time to maturity in years")]
        [DefaultValue(1.0)]
        public double TimeToMaturity { get; set; }

        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "Steps must be a positive integer.")]
        [SwaggerSchema(Description = "Number of steps in the simulation")]
        [DefaultValue(100)]
        public int Steps { get; set; }

        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "Simulations must be a positive integer.")]
        [SwaggerSchema(Description = "Number of simulations to run")]
        [DefaultValue(10000)]
        public int Simulations { get; set; }

        [Required]
        [SwaggerSchema(Description = "Is the option a call (true) or put (false)")]
        [DefaultValue(true)]
        public bool IsCall { get; set; }

        [SwaggerSchema(Description = "Use antithetic variates")]
        [DefaultValue(false)]
        public bool Antithetic { get; set; }

        [SwaggerSchema(Description = "Use control variates")]
        [DefaultValue(false)]
        public bool ControlVariate { get; set; }

        [SwaggerSchema(Description = "Use multithreaded execution")]
        [DefaultValue(false)]
        public bool Multithreaded { get; set; }

        [Required]
        [Range(1, 6, ErrorMessage = "Option Type must be between 1 and 6.")]
        [SwaggerSchema(Description = "Type of option (1=European, 2=Asian, 3=Digital, 4=Barrier, 5=Lookback, 6=Range)")]
        [DefaultValue(1)]
        public int OptionType { get; set; }

        [SwaggerSchema(Description = "Use Van der Corput sequence")]
        [DefaultValue(false)]
        public bool UseVDCSequence { get; set; }

        [Range(2, int.MaxValue, ErrorMessage = "Base1 must be greater than or equal to 2.")]
        [SwaggerSchema(Description = "First base for VDC sequence (if applicable)")]
        [DefaultValue(2)]
        public int Base1 { get; set; } = 2; // Set default value to 2

        [Range(2, int.MaxValue, ErrorMessage = "Base2 must be greater than or equal to 2.")]
        [SwaggerSchema(Description = "Second base for VDC sequence (if applicable)")]
        [DefaultValue(5)]
        public int Base2 { get; set; } = 5; // Set default value to 5

        [Range(0.0, double.MaxValue, ErrorMessage = "Rebate must be non-negative.")]
        [SwaggerSchema(Description = "Rebate amount for digital option (if applicable)")]
        [DefaultValue(0)]
        public double Rebate { get; set; }

        [Range(0.01, double.MaxValue, ErrorMessage = "Barrier must be greater than zero.")]
        [SwaggerSchema(Description = "Barrier level for barrier option (if applicable)")]
        [DefaultValue(1.0)]
        public double Barrier { get; set; } = 1.0; // Set default value to 1.0

        [Range(1, 4, ErrorMessage = "Barrier Type must be between 1 and 4.")]
        [SwaggerSchema(Description = "Barrier type (1=Up-and-In, 2=Up-and-Out, 3=Down-and-In, 4=Down-and-Out)")]
        [DefaultValue(1)]
        public int BarrierType { get; set; } = 1; // Set default value to 1
    }
}
