namespace MonteCarloSimulatorAPI.Dtos
{
    public sealed class HistoricalPriceUpsertDto
    {
        public string Symbol { get; set; } = string.Empty;

        public System.DateTime Date { get; set; }

        public double Price { get; set; }
    }

    public sealed class RatePointUpsertDto
    {
        public double Tenor { get; set; }

        public double Rate { get; set; }
    }
}
