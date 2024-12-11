using System.ComponentModel.DataAnnotations;

namespace MonteCarloSimulatorAPI.Models
{
    public abstract class Instrument
    {
        [Key]
        public int Id { get; set; }

        [Required]
        public string Symbol { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;
    }
}
