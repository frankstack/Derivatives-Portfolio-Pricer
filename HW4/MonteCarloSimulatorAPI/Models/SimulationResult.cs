namespace MonteCarloSimulatorAPI.Models
{
    public class SimulationResult
    {
        public double Price { get; set; }
        public double StandardError { get; set; }
        public double Delta { get; set; }
        public double Gamma { get; set; }
        public double Vega { get; set; }
        public double Theta { get; set; }
        public double Rho { get; set; }
    }
}

