using System.ComponentModel.DataAnnotations.Schema;

namespace MonteCarloSimulatorAPI.Models
{
    [Table("BarrierOptionEntities")]
    public class BarrierOptionEntity : OptionEntity
    {
        public double BarrierLevel { get; set; }
        public int BarrierType { get; set; } // 1=Up-and-In, 2=Up-and-Out
    }
}
