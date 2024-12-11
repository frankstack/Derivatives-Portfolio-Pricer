using System;
using System.Text.Json.Serialization;

namespace MonteCarloSimulatorAPI.Models
{
    public class HistoricalPrice
    {
        public int Id { get; set; }

        // Foreign key to Underlying
        public int UnderlyingId { get; set; }

        [JsonIgnore] // Make 'Underlying' value ignored by the Json reading procedure to avoid the serializer to loop indefinitely...
        public Underlying? Underlying { get; set; }

        public DateTime Date { get; set; }

        public double Price { get; set; }
    }
}
