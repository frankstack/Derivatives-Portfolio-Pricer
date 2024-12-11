using System;
using System.ComponentModel.DataAnnotations.Schema;

namespace MonteCarloSimulatorAPI.Models
{
    [Table("OptionEntities")]
    public abstract class OptionEntity : Instrument
    {
        public double StrikePrice { get; set; }
        public DateTime ExpirationDate { get; set; }
        public int OptionStyle { get; set; } // 1=European, 2=Asian, etc.
        public bool IsCall { get; set; }

        // Foreign key to Underlying
        public int UnderlyingId { get; set; }

        // Made Underlying nullable for convenience...
        public Underlying? Underlying { get; set; }
    }
}
