using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MonteCarloSimulatorAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddOptionEntitiesForAllOptionTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AsianOptionEntities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AsianOptionEntities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AsianOptionEntities_OptionEntities_Id",
                        column: x => x.Id,
                        principalTable: "OptionEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LookbackOptionEntities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LookbackOptionEntities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LookbackOptionEntities_OptionEntities_Id",
                        column: x => x.Id,
                        principalTable: "OptionEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RangeOptionEntities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RangeOptionEntities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RangeOptionEntities_OptionEntities_Id",
                        column: x => x.Id,
                        principalTable: "OptionEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AsianOptionEntities");

            migrationBuilder.DropTable(
                name: "LookbackOptionEntities");

            migrationBuilder.DropTable(
                name: "RangeOptionEntities");
        }
    }
}
