using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;

namespace MonteCarloSimulatorAPI.Models
{
    [Table("Underlyings")]
    public class Underlying : Instrument
    {
        // Additional properties specific to Underlying

        public ICollection<HistoricalPrice> HistoricalPrices { get; set; } = new List<HistoricalPrice>();
    }
}