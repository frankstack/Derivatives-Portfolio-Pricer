using System.Collections.Generic;

namespace MonteCarloSimulatorAPI.Models
{
    public class RateCurve
    {
        public int Id { get; set; }

        public string Name { get; set; } = string.Empty;

        public ICollection<RatePoint> RatePoints { get; set; } = new List<RatePoint>();
    }
}
