using System;
using System.ComponentModel.DataAnnotations.Schema;

namespace MonteCarloSimulatorAPI.Models
{
    public class Trade
    {
        public int Id { get; set; }

        public int InstrumentId { get; set; }

        [ForeignKey("InstrumentId")]
        // Made Instrument nullable to resolve warning
        public Instrument? Instrument { get; set; }

        public int Quantity { get; set; }

        public DateTime TradeDate { get; set; }

        public double Price { get; set; }
    }
}
