using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MonteCarloSimulatorAPI.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Instruments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Symbol = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Instruments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RateCurves",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RateCurves", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Trades",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    InstrumentId = table.Column<int>(type: "integer", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    TradeDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Price = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Trades", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Trades_Instruments_InstrumentId",
                        column: x => x.InstrumentId,
                        principalTable: "Instruments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Underlyings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Underlyings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Underlyings_Instruments_Id",
                        column: x => x.Id,
                        principalTable: "Instruments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RatePoints",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RateCurveId = table.Column<int>(type: "integer", nullable: false),
                    Tenor = table.Column<double>(type: "double precision", nullable: false),
                    Rate = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RatePoints", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RatePoints_RateCurves_RateCurveId",
                        column: x => x.RateCurveId,
                        principalTable: "RateCurves",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "HistoricalPrices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UnderlyingId = table.Column<int>(type: "integer", nullable: false),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Price = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HistoricalPrices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HistoricalPrices_Underlyings_UnderlyingId",
                        column: x => x.UnderlyingId,
                        principalTable: "Underlyings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OptionEntities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    StrikePrice = table.Column<double>(type: "double precision", nullable: false),
                    ExpirationDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    OptionStyle = table.Column<int>(type: "integer", nullable: false),
                    IsCall = table.Column<bool>(type: "boolean", nullable: false),
                    UnderlyingId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OptionEntities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OptionEntities_Instruments_Id",
                        column: x => x.Id,
                        principalTable: "Instruments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_OptionEntities_Underlyings_UnderlyingId",
                        column: x => x.UnderlyingId,
                        principalTable: "Underlyings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BarrierOptionEntities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    BarrierLevel = table.Column<double>(type: "double precision", nullable: false),
                    BarrierType = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BarrierOptionEntities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BarrierOptionEntities_OptionEntities_Id",
                        column: x => x.Id,
                        principalTable: "OptionEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DigitalOptionEntities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Rebate = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DigitalOptionEntities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DigitalOptionEntities_OptionEntities_Id",
                        column: x => x.Id,
                        principalTable: "OptionEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EuropeanOptionEntities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EuropeanOptionEntities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EuropeanOptionEntities_OptionEntities_Id",
                        column: x => x.Id,
                        principalTable: "OptionEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HistoricalPrices_UnderlyingId",
                table: "HistoricalPrices",
                column: "UnderlyingId");

            migrationBuilder.CreateIndex(
                name: "IX_OptionEntities_UnderlyingId",
                table: "OptionEntities",
                column: "UnderlyingId");

            migrationBuilder.CreateIndex(
                name: "IX_RatePoints_RateCurveId",
                table: "RatePoints",
                column: "RateCurveId");

            migrationBuilder.CreateIndex(
                name: "IX_Trades_InstrumentId",
                table: "Trades",
                column: "InstrumentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BarrierOptionEntities");

            migrationBuilder.DropTable(
                name: "DigitalOptionEntities");

            migrationBuilder.DropTable(
                name: "EuropeanOptionEntities");

            migrationBuilder.DropTable(
                name: "HistoricalPrices");

            migrationBuilder.DropTable(
                name: "RatePoints");

            migrationBuilder.DropTable(
                name: "Trades");

            migrationBuilder.DropTable(
                name: "OptionEntities");

            migrationBuilder.DropTable(
                name: "RateCurves");

            migrationBuilder.DropTable(
                name: "Underlyings");

            migrationBuilder.DropTable(
                name: "Instruments");
        }
    }
}
