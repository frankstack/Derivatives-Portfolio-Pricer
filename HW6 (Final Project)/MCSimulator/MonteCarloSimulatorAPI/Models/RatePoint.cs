using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace MonteCarloSimulatorAPI.Models
{
    public class RatePoint
    {
        public int Id { get; set; }

        public int RateCurveId { get; set; }

        [ForeignKey("RateCurveId")]
        [JsonIgnore] // Prevent serialization cycles and not required from client input
        public RateCurve? RateCurve { get; set; } // Make nullable

        public double Tenor { get; set; } // In years
        public double Rate { get; set; } // As decimal (e.g., 0.05 for 5%)
    }
}
