using Microsoft.EntityFrameworkCore;
using MonteCarloSimulatorAPI.Models;

namespace MonteCarloSimulatorAPI.Data
{
    public class ApplicationDbContext : DbContext
    {
        // Constructor
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
            : base(options)
        {
        }

        // DbSet properties
        public DbSet<Instrument> Instruments { get; set; } = null!;
        public DbSet<Underlying> Underlyings { get; set; } = null!;
        public DbSet<OptionEntity> OptionEntities { get; set; } = null!;
        public DbSet<EuropeanOptionEntity> EuropeanOptionEntities { get; set; } = null!;
        public DbSet<AsianOptionEntity> AsianOptionEntities { get; set; } = null!;
        public DbSet<DigitalOptionEntity> DigitalOptionEntities { get; set; } = null!;
        public DbSet<BarrierOptionEntity> BarrierOptionEntities { get; set; } = null!;
        public DbSet<LookbackOptionEntity> LookbackOptionEntities { get; set; } = null!;
        public DbSet<RangeOptionEntity> RangeOptionEntities { get; set; } = null!;
        public DbSet<Trade> Trades { get; set; } = null!;
        public DbSet<HistoricalPrice> HistoricalPrices { get; set; } = null!;
        public DbSet<RateCurve> RateCurves { get; set; } = null!;
        public DbSet<RatePoint> RatePoints { get; set; } = null!;

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Configure TPT inheritance for Instrument
            modelBuilder.Entity<Instrument>().ToTable("Instruments");
            modelBuilder.Entity<Underlying>().ToTable("Underlyings");
            modelBuilder.Entity<OptionEntity>().ToTable("OptionEntities");
            modelBuilder.Entity<EuropeanOptionEntity>().ToTable("EuropeanOptionEntities");
            modelBuilder.Entity<AsianOptionEntity>().ToTable("AsianOptionEntities");
            modelBuilder.Entity<DigitalOptionEntity>().ToTable("DigitalOptionEntities");
            modelBuilder.Entity<BarrierOptionEntity>().ToTable("BarrierOptionEntities");
            modelBuilder.Entity<LookbackOptionEntity>().ToTable("LookbackOptionEntities");
            modelBuilder.Entity<RangeOptionEntity>().ToTable("RangeOptionEntities");

            // Relationships and constraints
            modelBuilder.Entity<Trade>()
                .HasOne(t => t.Instrument)
                .WithMany()
                .HasForeignKey(t => t.InstrumentId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<HistoricalPrice>()
                .HasOne(h => h.Underlying)
                .WithMany(u => u.HistoricalPrices)
                .HasForeignKey(h => h.UnderlyingId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<RatePoint>()
                .HasOne(rp => rp.RateCurve)
                .WithMany(rc => rc.RatePoints)
                .HasForeignKey(rp => rp.RateCurveId)
                .OnDelete(DeleteBehavior.Cascade);
        }
    }
}
