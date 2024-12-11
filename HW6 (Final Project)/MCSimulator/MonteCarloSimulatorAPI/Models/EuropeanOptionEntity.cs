using System.ComponentModel.DataAnnotations.Schema;

namespace MonteCarloSimulatorAPI.Models
{
    [Table("EuropeanOptionEntities")]
    public class EuropeanOptionEntity : OptionEntity
    {
        // No additional properties needed for European Option
    }
}
