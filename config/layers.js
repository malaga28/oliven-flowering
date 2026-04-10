const layersConfig = {
  scoreRasters: {
    historical: {
      "1951-1980": "MPI_Weighted_Climate_Suitability_Score_HISTORICAL_1951_1980.tif",
      "1981-2014": "MPI_Weighted_Climate_Suitability_Score_HISTORICAL_1981_2014.tif"
    },
    future: {
      ssp245: {
        "2015-2040": "MPI_Weighted_Climate_Suitability_Score_SSP245_2015_2040.tif",
        "2041-2070": "MPI_Weighted_Climate_Suitability_Score_SSP245_2041_2070.tif",
        "2071-2100": "MPI_Weighted_Climate_Suitability_Score_SSP245_2071_2100.tif"
      },
      ssp585: {
        "2015-2040": "MPI_Weighted_Climate_Suitability_Score_SSP585_2015_2040.tif",
        "2041-2070": "MPI_Weighted_Climate_Suitability_Score_SSP585_2041_2070.tif",
        "2071-2100": "MPI_Weighted_Climate_Suitability_Score_SSP585_2071_2100.tif"
      }
    }
  },

  oliveRaster: "olives_4326.tif",

  chartCSVs: {
    historical: {
      "1951-1980": "1951.csv",
      "1981-2014": "1981.csv"
    },
    future: {
      ssp245: {
        "2015-2040": "2015_ssp245.csv",
        "2041-2070": "2041_ssp245.csv",
        "2071-2100": "2071_ssp245.csv"
      },
      ssp585: {
        "2015-2040": "2015_ssp585.csv",
        "2041-2070": "2041_ssp585.csv",
        "2071-2100": "2071_ssp585.csv"
      }
    }
  }
};
