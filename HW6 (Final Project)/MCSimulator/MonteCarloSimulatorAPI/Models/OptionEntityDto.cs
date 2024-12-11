using System.ComponentModel.DataAnnotations;

namespace MonteCarloSimulatorAPI.Models
{
    public class OptionEntityDto
    {
        [Required]
        public int Id { get; set; }

        [Required]
        public required string Symbol { get; set; }

        [Required]
        public required string Name { get; set; }

        [Required]
        public double StrikePrice { get; set; }

        [Required]
        public DateTime ExpirationDate { get; set; }

        [Required]
        public int OptionStyle { get; set; }

        [Required]
        public bool IsCall { get; set; }

        [Required]
        public int UnderlyingId { get; set; }

        [Required]
        [Range(1, 6, ErrorMessage = "Option Type must be between 1 and 6.")]
        public int OptionType { get; set; }

        public double Rebate { get; set; } // For Digital Options

        public double Barrier { get; set; } // For Barrier Options

        public int BarrierType { get; set; } // For Barrier Options
    }
}