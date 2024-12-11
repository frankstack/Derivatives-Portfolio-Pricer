using System.ComponentModel.DataAnnotations;
using System.Collections.Generic;

namespace MonteCarloSimulatorAPI.Models
{
    public class ValuationRequestDto
    {
        [Required]
        public List<int> TradeIds { get; set; } = new List<int>();

        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "Steps must be greater than zero.")]
        public int Steps { get; set; }

        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "Simulations must be greater than zero.")]
        public int Simulations { get; set; }

        [Required]
        public bool Antithetic { get; set; }

        [Required]
        public bool ControlVariate { get; set; }

        [Required]
        public bool Multithreaded { get; set; }

        [Required]
        public bool UseVDCSequence { get; set; }

        [Range(2, int.MaxValue, ErrorMessage = "Base1 must be >= 2.")]
        public int Base1 { get; set; } = 2; // Default to 2 if not provided...

        [Range(2, int.MaxValue, ErrorMessage = "Base2 must be >= 2.")]
        public int Base2 { get; set; } = 5; // Default to 5 if not provided...

        // We'll add... RATE CURVE WE WANT TO USE!
        public int RateCurveId { get; set; } 
    }
}
