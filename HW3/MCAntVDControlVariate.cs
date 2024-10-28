#pragma warning disable CS8600
#pragma warning disable CS8602
#pragma warning disable CS8618

// Class for final general output print
public class SimulationOutput
{
    // Method to display results
    public static void DisplayResults(string optionType, Tuple<double, double, double, double, double, double, double> results)
    {
        Console.WriteLine($"{optionType} Option Results:");
        Console.WriteLine($"- Price: {results.Item1},");
        Console.WriteLine($"- Standard Error: {results.Item2},");
        Console.WriteLine($"- Delta: {results.Item3},");
        Console.WriteLine($"- Gamma: {results.Item4},");
        Console.WriteLine($"- Vega: {results.Item5},");
        Console.WriteLine($"- Theta: {results.Item6},");
        Console.WriteLine($"- Rho: {results.Item7}");
        Console.WriteLine("-----------------------------------------------------------------");
    }
}

// Class for mathematical extensions
public static class MathExtensions
{
    // Standard normal cumulative distribution function (CDF) | Method: Abramowitz & Stegun (formula 7.1.26)
    public static double NormalCdf(double x)
    {
        // Constants for approximation
        double a1 = 0.254829592;
        double a2 = -0.284496736;
        double a3 = 1.421413741;
        double a4 = -1.453152027;
        double a5 = 1.061405429;
        double p = 0.3275911;

        // Save the sign of x
        int sign = 1;
        if (x < 0)
            sign = -1;
        x = Math.Abs(x) / Math.Sqrt(2.0);

        // A&S formula 7.1.26 for approximation
        double t = 1.0 / (1.0 + p * x);
        double y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.Exp(-x * x);

        return 0.5 * (1.0 + sign * y);
    }

    // Standard normal probability density function (PDF)
    public static double NormalPdf(double x)
    {
        return (1.0 / Math.Sqrt(2.0 * Math.PI)) * Math.Exp(-0.5 * x * x);
    }
}

// Class for Random Number Generator | Multidimensional Form (No Low-Discrepancy Sequence)
public class RandomNumberGenerator
{
    // Random number generator
    private static Random rand = new Random();

    // Matrix to store generated random numbers
    public double[,] RandomNumbers { get; set; }

    // Constructor to initialize random number generation
    public RandomNumberGenerator(int simulations, int steps, bool antithetic)
    {
        GenerateRandomNumbers(simulations, steps, antithetic);
    }

    // Method to generate random numbers
    private void GenerateRandomNumbers(int simulations, int steps, bool antithetic)
    {
        int effectiveSimulations = antithetic ? simulations / 2 : simulations;
        RandomNumbers = new double[simulations, steps];

        for (int i = 0; i < effectiveSimulations; i++)
        {
            for (int j = 0; j < steps; j++)
            {
                double normalSample = GenerateNormalStandardBoxMuller().Item1;
                RandomNumbers[i, j] = normalSample;
                if (antithetic)
                {
                    RandomNumbers[i + effectiveSimulations, j] = -normalSample;
                }
            }
        }
    }

    // Generate standard normal random variables using Box-Muller transformation
    private static Tuple<double, double> GenerateNormalStandardBoxMuller()
    {
        double x1, x2, z1, z2;
        do
        {
            x1 = rand.NextDouble();
            x2 = rand.NextDouble();
        }
        while (x1 <= double.Epsilon);

        z1 = Math.Sqrt(-2.0 * Math.Log(x1)) * Math.Cos(2 * Math.PI * x2);
        z2 = Math.Sqrt(-2.0 * Math.Log(x1)) * Math.Sin(2 * Math.PI * x2);

        return Tuple.Create(z1, z2);
    }
}

// Class for Random Number Generator under the VDC Framework | Unidimensional Form (Low-Discrepancy Sequence)
public class VanDerCorputGenerator
{
    private static Random rand = new Random();

    // Matrix to store generated random numbers
    public double[,] RandomNumbers { get; set; }

    // Constructor to initialize the random number generation process
    public VanDerCorputGenerator(int simulations, int steps, int base1, int base2)
    {
        GenerateRandomNumbers(simulations, steps, base1, base2);
    }

    // Method to generate random numbers using Van der Corput sequence
    private void GenerateRandomNumbers(int simulations, int steps, int base1, int base2)
    {
        RandomNumbers = new double[simulations, steps];
        int halfSimulations = simulations / 2;

        for (int i = 0; i < simulations; i++)
        {
            int currentBase = i < halfSimulations || (simulations % 2 != 0 && i == simulations - 1) ? base1 : base2;
            for (int j = 0; j < steps; j++)
            {
                var values = GenerateNormalBoxMullerWithVanDerCorput(currentBase);
                RandomNumbers[i, j] = values.Item1;  // Using z1
            }
        }
    }

    // Method to generate a pair of normally distributed random numbers (z1, z2)
    private static Tuple<double, double> GenerateNormalBoxMullerWithVanDerCorput(int baseVal)
    {
        double x1, x2, z1, z2;
        int seed1, seed2;
        do
        {
            seed1 = rand.Next(1, 100000);
            seed2 = rand.Next(1, 100000);
            x1 = VanDerCorput(seed1, baseVal);
            x2 = VanDerCorput(seed2, baseVal);
        }
        while (x1 <= double.Epsilon);

        z1 = Math.Sqrt(-2.0 * Math.Log(x1)) * Math.Cos(2 * Math.PI * x2);
        z2 = Math.Sqrt(-2.0 * Math.Log(x1)) * Math.Sin(2 * Math.PI * x2);

        return Tuple.Create(z1, z2);
    }

    // Method to generate a single Van der Corput sequence value
    private static double VanDerCorput(int seed, int baseNum)
    {
        double vdc = 0, denom = 1;
        while (seed > 0)
        {
            denom *= baseNum;
            vdc += (seed % baseNum) / denom;
            seed /= baseNum;
        }
        return vdc;
    }
}

// Class to compute the Monte Carlo Simulation (Euler Maruyama Scheme)
public class SimulationManager
{
    // Function to run the simulations
    public static double[] RunSimulation(
        Option option,
        double stockPrice, double riskFreeRate,
        double volatility, double timeToMaturity,
        int steps, int simulations, double[,] randomNumbers,
        bool controlVariate, bool multithreaded  // Added multithreaded parameter
        )
    {
        double dt = timeToMaturity / steps;
        double drift = (riskFreeRate - 0.5 * volatility * volatility) * dt;
        double vol = volatility * Math.Sqrt(dt);
        double erddt = Math.Exp(riskFreeRate * dt);
        double[] payoffs = new double[simulations];

        // Activation of multithreaded 
        if (multithreaded)
        {
            // Get the number of logical processors
            int processorCount = Environment.ProcessorCount;
            ParallelOptions parallelOptions = new ParallelOptions { MaxDegreeOfParallelism = processorCount };

            // Use Parallel.For to parallelize the simulation over simulations
            Parallel.For(0, simulations, parallelOptions, i =>
            {
                List<double> pricePath = new List<double>();
                double s = stockPrice;
                pricePath.Add(s);
                double cv1 = 0.0; // Initialize control variate accumulator

                for (int j = 0; j < steps; j++)
                {
                    double s_prev = s;
                    s = s * Math.Exp(drift + vol * randomNumbers[i, j]);
                    pricePath.Add(s);
                    // Control Variate Execution
                    if (controlVariate)
                    {
                        double t = j * dt;
                        double delta = option.Delta(s_prev, riskFreeRate, volatility, timeToMaturity, t);
                        cv1 += delta * (s - s_prev * erddt);
                    }
                }

                double optionPayoff = option.Payoff(pricePath);

                if (controlVariate)
                {
                    double adjustedPayoff = optionPayoff - cv1;
                    payoffs[i] = adjustedPayoff;
                }
                else
                {
                    payoffs[i] = optionPayoff;
                }
            });
        }
        else
        {
            // Original sequential code
            for (int i = 0; i < simulations; i++)
            {
                List<double> pricePath = new List<double>();
                double s = stockPrice;
                pricePath.Add(s);
                double cv1 = 0.0; // Initialize control variate accumulator

                for (int j = 0; j < steps; j++)
                {
                    double s_prev = s;
                    s = s * Math.Exp(drift + vol * randomNumbers[i, j]);
                    pricePath.Add(s);
                    // Control Variate Execution
                    if (controlVariate)
                    {
                        double t = j * dt;
                        double delta = option.Delta(s_prev, riskFreeRate, volatility, timeToMaturity, t);
                        cv1 += delta * (s - s_prev * erddt);
                    }
                }

                double optionPayoff = option.Payoff(pricePath);

                if (controlVariate)
                {
                    double adjustedPayoff = optionPayoff - cv1;
                    payoffs[i] = adjustedPayoff;
                }
                else
                {
                    payoffs[i] = optionPayoff;
                }
            }
        }
        return payoffs;
    }
}

// Main Greeks Calculator
public class GreeksCalculator
{
    // Calculate Delta and Gamma
    private static Tuple<double, double> CalculateDeltaAndGamma(
        Option option,
        double stockPrice, double shock, double riskFreeRate,
        double volatility, double timeToMaturity, int steps,
        int simulations, double[,] randomNumbers, double V_CurrentPrice, bool controlVariate, bool multithreaded  // Added multithreaded parameter
        )
    {
        var deltaS = stockPrice * shock;

        double[] bumpedPriceUpPayoffs = SimulationManager.RunSimulation(
            option, stockPrice + deltaS,
            riskFreeRate, volatility, timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded);

        double[] bumpedPriceDownPayoffs = SimulationManager.RunSimulation(
            option, stockPrice - deltaS,
            riskFreeRate, volatility, timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded);

        double V_up = bumpedPriceUpPayoffs.Average() * Math.Exp(-riskFreeRate * timeToMaturity);
        double V_down = bumpedPriceDownPayoffs.Average() * Math.Exp(-riskFreeRate * timeToMaturity);

        double deltaVal = (V_up - V_down) / (2 * deltaS);
        double gammaVal = (V_up - 2 * V_CurrentPrice + V_down) / Math.Pow(deltaS, 2);

        return Tuple.Create(deltaVal, gammaVal);
    }

    // Calculate Vega
    private static double CalculateVega(
        Option option,
        double volatility, double shock, double stockPrice, double riskFreeRate,
        double timeToMaturity, int steps, int simulations, double[,] randomNumbers, bool controlVariate, bool multithreaded  // Added multithreaded parameter
        )
    {
        double bumpedVolUp = volatility + shock;
        double bumpedVolDown = volatility - shock;

        double[] bumpedPriceUpPayoffs = SimulationManager.RunSimulation(
            option, stockPrice,
            riskFreeRate, bumpedVolUp, timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded);

        double[] bumpedPriceDownPayoffs = SimulationManager.RunSimulation(
            option, stockPrice,
            riskFreeRate, bumpedVolDown, timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded);

        double V_sigma_up = bumpedPriceUpPayoffs.Average() * Math.Exp(-riskFreeRate * timeToMaturity);
        double V_sigma_down = bumpedPriceDownPayoffs.Average() * Math.Exp(-riskFreeRate * timeToMaturity);

        return (V_sigma_up - V_sigma_down) / (2 * shock);
    }

    // Calculate Theta
    private static double CalculateTheta(
        Option option,
        double timeToMaturity, double shock,
        double stockPrice, double riskFreeRate, double volatility,
        int steps, int simulations, double[,] randomNumbers, double V_CurrentPrice, bool controlVariate, bool multithreaded  // Added multithreaded parameter
        )
    {
        var deltaT = timeToMaturity * shock;
        double bumpedTimeDown = timeToMaturity - deltaT;

        double[] bumpedPricePayoffs = SimulationManager.RunSimulation(
            option, stockPrice, riskFreeRate, volatility,
            bumpedTimeDown, steps, simulations, randomNumbers, controlVariate, multithreaded);

        double V_T_down = bumpedPricePayoffs.Average() * Math.Exp(-riskFreeRate * bumpedTimeDown);

        return (V_CurrentPrice - V_T_down) / shock;
    }

    // Calculate Rho
    private static double CalculateRho(
        Option option,
        double riskFreeRate, double shock, double stockPrice, double volatility,
        double timeToMaturity, int steps, int simulations, double[,] randomNumbers, bool controlVariate, bool multithreaded  // Added multithreaded parameter
        )
    {
        var deltaR = riskFreeRate * shock;

        double[] bumpedPriceR_UpPayoffs = SimulationManager.RunSimulation(
            option, stockPrice, riskFreeRate + deltaR, volatility, timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded);

        double[] bumpedPriceR_DownPayoffs = SimulationManager.RunSimulation(
            option, stockPrice, riskFreeRate - deltaR, volatility, timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded);

        double V_r_up = bumpedPriceR_UpPayoffs.Average() * Math.Exp(-(riskFreeRate + deltaR) * timeToMaturity);
        double V_r_down = bumpedPriceR_DownPayoffs.Average() * Math.Exp(-(riskFreeRate - deltaR) * timeToMaturity);

        return (V_r_up - V_r_down) / (2 * deltaR);
    }

    // Main function to calculate option price and Greeks using Monte Carlo
    public static Tuple<double, double, double, double, double, double, double> CalculateOptionPriceAndGreeks(
        Option option,
        double stockPrice, double riskFreeRate,
        double volatility, double timeToMaturity, int steps,
        int simulations, double[,] randomNumbers, bool antithetic, bool controlVariate, bool multithreaded  // Added multithreaded parameter
        )
    {
        double shock = 0.01;

        double[] VPayoffs = SimulationManager.RunSimulation(
            option, stockPrice, riskFreeRate, volatility,
            timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded
            );

        double VPrice = VPayoffs.Average() * Math.Exp(-riskFreeRate * timeToMaturity);
        // Antithetic Activation
        double VStandardError;
        if (antithetic)
        {
            int halfSimulations = simulations / 2;
            double[] averagePayoffs = new double[halfSimulations];
            for (int i = 0; i < halfSimulations; i++)
            {
                averagePayoffs[i] = (VPayoffs[i] + VPayoffs[i + halfSimulations]) / 2;
            }
            double mean = averagePayoffs.Average();
            double variance = averagePayoffs.Select(x => Math.Pow(x - mean, 2)).Sum() / halfSimulations;
            VStandardError = Math.Sqrt(variance / halfSimulations);
        }
        else
        {
            double mean = VPayoffs.Average();
            double variance = VPayoffs.Select(x => Math.Pow(x - mean, 2)).Sum() / (simulations - 1);
            VStandardError = Math.Sqrt(variance) / Math.Sqrt(simulations);
        }

        var DeltaAndGammaTuple = CalculateDeltaAndGamma(
            option, stockPrice, shock, riskFreeRate,
            volatility, timeToMaturity, steps,
            simulations, randomNumbers, VPrice, controlVariate, multithreaded
            );

        double VVega = CalculateVega(
            option,
            volatility, shock, stockPrice, riskFreeRate,
            timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded
        );

        double VTheta = CalculateTheta(
            option,
            timeToMaturity, shock,
            stockPrice, riskFreeRate, volatility,
            steps, simulations, randomNumbers, VPrice, controlVariate, multithreaded);

        double VRho = CalculateRho(
            option,
            riskFreeRate, shock, stockPrice, volatility,
            timeToMaturity, steps, simulations, randomNumbers, controlVariate, multithreaded);

        return Tuple.Create(VPrice, VStandardError, DeltaAndGammaTuple.Item1, DeltaAndGammaTuple.Item2, VVega, VTheta, VRho);
    }
}

// Abstract Class that contains the different options types
public abstract class Option
{
    // Property #1: Strike Price
    public double StrikePrice { get; }
    // Property #2: is Call/Put form
    public bool IsCall { get; }

    // Protected constructor to store properties
    protected Option(double strikePrice, bool isCall)
    {
        StrikePrice = strikePrice;
        IsCall = isCall;
    }

    // Abstract method for payoff calculation
    public abstract double Payoff(List<double> pricePath);

    // Abstract method for delta calculation (to be overridden in derived classes)
    public abstract double Delta(double stockPrice, double riskFreeRate, double volatility, double timeToMaturity, double time);
}

// Inherited class for European options
public class EuropeanOption : Option
{
    // Base Constructor
    public EuropeanOption(double strikePrice, bool isCall) : base(strikePrice, isCall) { }

    // Payoff Logic Functionality
    public override double Payoff(List<double> pricePath)
    {
        double finalPrice = pricePath.Last();
        if (IsCall)
        {
            return Math.Max(finalPrice - StrikePrice, 0);
        }
        else
        {
            return Math.Max(StrikePrice - finalPrice, 0);
        }
    }

    // Delta Calculation using Black-Scholes formula
    public override double Delta(double stockPrice, double riskFreeRate, double volatility, double timeToMaturity, double time)
    {
        double tau = timeToMaturity - time;
        if (tau <= 0)
            return 0; // Option has expired

        double d1 = (Math.Log(stockPrice / StrikePrice) + (riskFreeRate + 0.5 * volatility * volatility) * tau) / (volatility * Math.Sqrt(tau));

        if (IsCall)
        {
            return MathExtensions.NormalCdf(d1);
        }
        else
        {
            return MathExtensions.NormalCdf(d1) - 1;
        }
    }
}

// Inherited class for Asian (geometric average price) options
public class AsianOption : Option
{
    public AsianOption(double strikePrice, bool isCall) : base(strikePrice, isCall) { }

    public override double Payoff(List<double> pricePath)
    {
        // Compute geometric average
        double logSum = 0.0;
        int n = pricePath.Count;
        foreach (double price in pricePath)
        {
            logSum += Math.Log(price);
        }
        double geometricAverage = Math.Exp(logSum / n);

        if (IsCall)
        {
            return Math.Max(geometricAverage - StrikePrice, 0);
        }
        else
        {
            return Math.Max(StrikePrice - geometricAverage, 0);
        }
    }

    public override double Delta(double stockPrice, double riskFreeRate, double volatility, double timeToMaturity, double time)
    {
        // For simplicity, return zero
        return 0.0;
    }
}

// Inherited class for Digital options
public class DigitalOption : Option
{
    public double Rebate { get; } // The fixed amount paid if the option is in the money

    public DigitalOption(double strikePrice, bool isCall, double rebate) : base(strikePrice, isCall)
    {
        Rebate = rebate;
    }

    public override double Payoff(List<double> pricePath)
    {
        double finalPrice = pricePath.Last();

        if (IsCall)
        {
            return finalPrice > StrikePrice ? Rebate : 0.0;
        }
        else
        {
            return finalPrice < StrikePrice ? Rebate : 0.0;
        }
    }

    public override double Delta(double stockPrice, double riskFreeRate, double volatility, double timeToMaturity, double time)
    {
        double tau = timeToMaturity - time;
        if (tau <= 0)
            return 0; // Option has expired

        double d1 = (Math.Log(stockPrice / StrikePrice) + (riskFreeRate + 0.5 * volatility * volatility) * tau) / (volatility * Math.Sqrt(tau));
        double d2 = d1 - volatility * Math.Sqrt(tau);

        double delta;

        if (IsCall)
        {
            delta = (Math.Exp(-riskFreeRate * tau) * MathExtensions.NormalPdf(d2)) / (stockPrice * volatility * Math.Sqrt(tau)) * Rebate;
        }
        else
        {
            delta = -(Math.Exp(-riskFreeRate * tau) * MathExtensions.NormalPdf(-d2)) / (stockPrice * volatility * Math.Sqrt(tau)) * Rebate;
        }

        return delta;
    }
}

// Enum for Barrier types (base class)
public enum BarrierType
{
    UpAndIn,
    UpAndOut,
    DownAndIn,
    DownAndOut
}

// Inherited class for Barrier options
public class BarrierOption : Option
{
    public double Barrier { get; }
    public BarrierType BarrierType { get; }

    public BarrierOption(double strikePrice, bool isCall, double barrier, BarrierType barrierType)
        : base(strikePrice, isCall)
    {
        Barrier = barrier;
        BarrierType = barrierType;
    }

    public override double Payoff(List<double> pricePath)
    {
        bool barrierHit = false;

        switch (BarrierType)
        {
            case BarrierType.UpAndIn:
                barrierHit = pricePath.Any(price => price >= Barrier);
                break;
            case BarrierType.UpAndOut:
                barrierHit = pricePath.Any(price => price >= Barrier);
                break;
            case BarrierType.DownAndIn:
                barrierHit = pricePath.Any(price => price <= Barrier);
                break;
            case BarrierType.DownAndOut:
                barrierHit = pricePath.Any(price => price <= Barrier);
                break;
        }

        bool optionExists = false;

        if ((BarrierType == BarrierType.UpAndIn || BarrierType == BarrierType.DownAndIn) && barrierHit)
        {
            optionExists = true;
        }
        else if ((BarrierType == BarrierType.UpAndOut || BarrierType == BarrierType.DownAndOut) && !barrierHit)
        {
            optionExists = true;
        }

        if (optionExists)
        {
            double finalPrice = pricePath.Last();
            if (IsCall)
            {
                return Math.Max(finalPrice - StrikePrice, 0);
            }
            else
            {
                return Math.Max(StrikePrice - finalPrice, 0);
            }
        }
        else
        {
            return 0.0;
        }
    }

    public override double Delta(double stockPrice, double riskFreeRate, double volatility, double timeToMaturity, double time)
    {
        // For simplicity, return zero
        return 0.0;
    }
}

// Inherited class for Lookback options
public class LookbackOption : Option
{
    public LookbackOption(double strikePrice, bool isCall) : base(strikePrice, isCall) { }

    public override double Payoff(List<double> pricePath)
    {
        if (IsCall)
        {
            double maxPrice = pricePath.Max();
            return Math.Max(maxPrice - StrikePrice, 0);
        }
        else
        {
            double minPrice = pricePath.Min();
            return Math.Max(StrikePrice - minPrice, 0);
        }
    }

    public override double Delta(double stockPrice, double riskFreeRate, double volatility, double timeToMaturity, double time)
    {
        // For simplicity, return zero
        return 0.0;
    }
}

// Inherited class for Range options
public class RangeOption : Option
{
    public RangeOption(double strikePrice, bool isCall) : base(strikePrice, isCall) { }

    public override double Payoff(List<double> pricePath)
    {
        double maxPrice = pricePath.Max();
        double minPrice = pricePath.Min();
        return maxPrice - minPrice;
    }

    public override double Delta(double stockPrice, double riskFreeRate, double volatility, double timeToMaturity, double time)
    {
        // For simplicity, return zero
        return 0.0;
    }
}

// Main Monte Carlo Simulator Functionality
public class MonteCarloSimulator
{
    // Main method
    public static void Main()
    {
        // Local function to get and validate user input
        double GetValidInput(string prompt)
        {
            double input;
            Console.Write(prompt);
            string userInput;
            while (true)
            {
                userInput = Console.ReadLine();
                if (userInput.ToLower() == "exit")
                {
                    Console.WriteLine("Exiting program.");
                    Environment.Exit(0);
                }
                if (double.TryParse(userInput, out input))
                {
                    return input;
                }
                Console.WriteLine("Invalid input, please try again.");
                Console.Write(prompt);
            }
        }

        // Local function to validate binary input
        double GetBinaryInput(string prompt)
        {
            while (true)
            {
                double value = GetValidInput(prompt);
                if (value == 0 || value == 1)
                {
                    return value;
                }
                Console.WriteLine("Invalid input. Please enter 1 (yes) or 0 (no).");
            }
        }

        Console.WriteLine("***>>> ------ FM5353 | Monte Carlo Simulator ------ <<<***");
        Console.WriteLine("            >> Exotic Options Type Class <<        ");
        Console.WriteLine(" Enter 'exit' at any time to close the program. ");
        Console.WriteLine("**------------------------------------------------------**");
        Console.WriteLine("> Note: If Van der Corput sequence is activated, Antithetic and Control Variate cannot be activated.\n");

        // Ingesting base user input parameters
        Console.WriteLine(">>> User Parameters Input:::\n");
        double stockPrice = GetValidInput("Enter stock price: ");
        double strikePrice = GetValidInput("Enter strike price: ");
        double riskFreeRate = GetValidInput("Enter risk-free rate: ");
        double volatility = GetValidInput("Enter volatility: ");
        double timeToMaturity = GetValidInput("Enter time to maturity (in years): ");
        double VDCSequence = GetBinaryInput("Activate Van der Corput Sequence (1: yes, 0: no): ");

        // Set default init values for antithetic and control variate as false
        bool antithetic = false;
        bool controlVariate = false;
        int steps = 1;
        int base1 = 0;
        int base2 = 0;

        if (VDCSequence == 1)
        {
            base1 = (int)GetValidInput("Enter the valid prime base #1: ");
            base2 = (int)GetValidInput("Enter the valid prime base #2: ");
            // If VDC Sequence is required, no antithetic neither control variate
            antithetic = false;
            controlVariate = false;
        }
        else
        {
            antithetic = GetBinaryInput("Activate Antithetic Variable (1: yes, 0: no): ") == 1;
            controlVariate = GetBinaryInput("Activate Control Variate (1: yes, 0: no): ") == 1;
            steps = (int)GetValidInput("Enter number of steps: ");
        }

        int simulations = (int)GetValidInput("Enter number of simulations: ");

        // Added prompt for multithreading option
        double multithreadingOption = GetBinaryInput(">> COMPUTATION: Enable multithreaded execution (1: yes, 0: no): ");
        bool multithreaded = multithreadingOption == 1;

        // Option selection
        Console.WriteLine("\nSelect Option Type:");
        Console.WriteLine("(1) European Option");
        Console.WriteLine("(2) Asian Option (Geometric)");
        Console.WriteLine("(3) Digital Option");
        Console.WriteLine("(4) Barrier Option");
        Console.WriteLine("(5) Lookback Option");
        Console.WriteLine("(6) Range Option");
        int optionType = (int)GetValidInput("Enter option type (1-6): ");

        bool isCall = GetBinaryInput("Is it a Call option? (1: yes, 0: no): ") == 1;

        Option option = null;

        switch (optionType)
        {
            case 1:
                option = new EuropeanOption(strikePrice, isCall);
                break;
            case 2:
                option = new AsianOption(strikePrice, isCall);
                break;
            case 3:
                double rebate = GetValidInput("Enter rebate amount: ");
                option = new DigitalOption(strikePrice, isCall, rebate);
                break;
            case 4:
                double barrier = GetValidInput("Enter barrier level: ");
                Console.WriteLine("Select Barrier Type:");
                Console.WriteLine("1) Up-and-In");
                Console.WriteLine("2) Up-and-Out");
                Console.WriteLine("3) Down-and-In");
                Console.WriteLine("4) Down-and-Out");
                int barrierTypeInput = (int)GetValidInput("Enter barrier type (1-4): ");
                BarrierType barrierType = BarrierType.UpAndIn;
                switch (barrierTypeInput)
                {
                    case 1:
                        barrierType = BarrierType.UpAndIn;
                        break;
                    case 2:
                        barrierType = BarrierType.UpAndOut;
                        break;
                    case 3:
                        barrierType = BarrierType.DownAndIn;
                        break;
                    case 4:
                        barrierType = BarrierType.DownAndOut;
                        break;
                    default:
                        Console.WriteLine("Invalid barrier type, defaulting to Up-and-In.");
                        barrierType = BarrierType.UpAndIn;
                        break;
                }
                option = new BarrierOption(strikePrice, isCall, barrier, barrierType);
                break;
            case 5:
                option = new LookbackOption(strikePrice, isCall);
                break;
            case 6:
                option = new RangeOption(strikePrice, isCall);
                break;
            default:
                Console.WriteLine("Invalid option type selected. Exiting program.");
                Environment.Exit(0);
                break;
        }

        // Processing message
        Console.WriteLine("\n>>> Processing the FM5353 MC Simulator....\n");

        // Generate random numbers
        double[,] randomNumbersContainer;
        if (VDCSequence == 1)
        {
            randomNumbersContainer = new VanDerCorputGenerator(simulations, steps, base1, base2).RandomNumbers;
        }
        else
        {
            randomNumbersContainer = new RandomNumberGenerator(simulations, steps, antithetic).RandomNumbers;
        }

        // Run the process for the selected Option
        var results = GreeksCalculator.CalculateOptionPriceAndGreeks(
            option, stockPrice, riskFreeRate,
            volatility, timeToMaturity, steps, simulations, randomNumbersContainer, antithetic, controlVariate, multithreaded
            );

        // Display results
        Console.WriteLine("::: >>> FM5353 - Monte Carlo Simulator ||| General Results:");
        Console.WriteLine("        **************************************************");
        SimulationOutput.DisplayResults("Option", results);
        Console.WriteLine("\n >>> Program Finished");
    }
}