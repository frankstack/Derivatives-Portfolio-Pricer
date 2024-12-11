using System.ComponentModel.DataAnnotations.Schema;

namespace MonteCarloSimulatorAPI.Models
{
    [Table("DigitalOptionEntities")]
    public class DigitalOptionEntity : OptionEntity
    {
        public double Rebate { get; set; }
    }
}
