using System;

namespace MonteCarloSimulatorAPI.Models
{
    // What the API returns for a derivative: the common fields plus the ones only some option
    // types have, under the same names the POST and PUT bodies use (rebate, barrier, barrierType).
    public class OptionEntityResponseDto
    {
        private static readonly string[] OptionTypeNames =
            { "", "European", "Asian", "Digital", "Barrier", "Lookback", "Range" };

        private static readonly string[] BarrierTypeNames =
            { "", "Up-and-In", "Up-and-Out", "Down-and-In", "Down-and-Out" };

        public int Id { get; set; }
        public string Symbol { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public double StrikePrice { get; set; }
        public DateTime ExpirationDate { get; set; }
        public int OptionStyle { get; set; }

        // 1=European, 2=Asian, 3=Digital, 4=Barrier, 5=Lookback, 6=Range
        public int OptionType { get; set; }
        public string OptionTypeName { get; set; } = string.Empty;

        public bool IsCall { get; set; }
        public int UnderlyingId { get; set; }
        public UnderlyingSummaryDto? Underlying { get; set; }

        // Digital options only
        public double? Rebate { get; set; }

        // Barrier options only: the level, and 1=Up-and-In, 2=Up-and-Out, 3=Down-and-In, 4=Down-and-Out
        public double? Barrier { get; set; }
        public int? BarrierType { get; set; }
        public string? BarrierTypeName { get; set; }

        public static OptionEntityResponseDto From(OptionEntity option)
        {
            int optionType;
            if (option is EuropeanOptionEntity) optionType = 1;
            else if (option is AsianOptionEntity) optionType = 2;
            else if (option is DigitalOptionEntity) optionType = 3;
            else if (option is BarrierOptionEntity) optionType = 4;
            else if (option is LookbackOptionEntity) optionType = 5;
            else if (option is RangeOptionEntity) optionType = 6;
            else optionType = option.OptionStyle;

            var dto = new OptionEntityResponseDto
            {
                Id = option.Id,
                Symbol = option.Symbol,
                Name = option.Name,
                StrikePrice = option.StrikePrice,
                ExpirationDate = option.ExpirationDate,
                OptionStyle = option.OptionStyle,
                OptionType = optionType,
                OptionTypeName = optionType >= 1 && optionType <= 6 ? OptionTypeNames[optionType] : string.Empty,
                IsCall = option.IsCall,
                UnderlyingId = option.UnderlyingId
            };

            if (option.Underlying != null)
            {
                dto.Underlying = new UnderlyingSummaryDto
                {
                    Id = option.Underlying.Id,
                    Symbol = option.Underlying.Symbol,
                    Name = option.Underlying.Name
                };
            }

            if (option is DigitalOptionEntity digital)
            {
                dto.Rebate = digital.Rebate;
            }

            if (option is BarrierOptionEntity barrierOption)
            {
                dto.Barrier = barrierOption.BarrierLevel;
                dto.BarrierType = barrierOption.BarrierType;
                dto.BarrierTypeName = barrierOption.BarrierType >= 1 && barrierOption.BarrierType <= 4
                    ? BarrierTypeNames[barrierOption.BarrierType]
                    : null;
            }

            return dto;
        }
    }

    // The underlying of a derivative, without its price history
    public class UnderlyingSummaryDto
    {
        public int Id { get; set; }
        public string Symbol { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }
}
