import { SpreadsheetSheetData } from '../types';

export const DEFAULT_PRICING_SNAPSHOT = {
  "lastConfirmedDate": null,
  "lastConfirmedAt": null,
  "lastConfirmedBy": null,
  "confirmationType": null,
  "sheets": {
    "yarn": {
      "id": "yarn",
      "name": "Yarn Ex-Mill Prices",
      "description": "Daily Ex-Mill pricing for knitting, weaving, and double cotton yarns (₹/kg)",
      "columns": [
        {
          "id": "yarnCount",
          "name": "Yarn Count",
          "type": "text",
          "width": 140
        },
        {
          "id": "quality",
          "name": "Quality",
          "type": "text",
          "width": 120
        },
        {
          "id": "category",
          "name": "Category",
          "type": "text",
          "width": 160
        },
        {
          "id": "exMillPrice",
          "name": "Ex-Mill Price (₹/kg)",
          "type": "number",
          "width": 160
        },
        {
          "id": "factoryLocation",
          "name": "Factory Location",
          "type": "text",
          "width": 180
        }
      ],
      "rows": [
        {
          "id": "yarn_row_1",
          "yarnCount": "NE 16/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": 100,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_2",
          "yarnCount": "NE 16/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": 200,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_3",
          "yarnCount": "NE 16/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 300,
          "factoryLocation": "Tamil Nadu"
        },
        {
          "id": "yarn_row_4",
          "yarnCount": "NE 20/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": 268,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_5",
          "yarnCount": "NE 20/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": 284,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_6",
          "yarnCount": "NE 20/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 285,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_7",
          "yarnCount": "NE 24/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": 278,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_8",
          "yarnCount": "NE 24/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": 294,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_9",
          "yarnCount": "NE 24/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 296,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_10",
          "yarnCount": "NE 26/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": 282,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_11",
          "yarnCount": "NE 26/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": 301,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_12",
          "yarnCount": "NE 26/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 300,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_13",
          "yarnCount": "NE 28/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": 287,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_14",
          "yarnCount": "NE 28/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": 300,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_15",
          "yarnCount": "NE 28/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 303,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_16",
          "yarnCount": "NE 30/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": 288,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_17",
          "yarnCount": "NE 30/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": 302,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_18",
          "yarnCount": "NE 30/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 305,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_19",
          "yarnCount": "NE 32/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_20",
          "yarnCount": "NE 32/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_21",
          "yarnCount": "NE 32/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 310,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_22",
          "yarnCount": "NE 34/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_23",
          "yarnCount": "NE 34/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_24",
          "yarnCount": "NE 34/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 322,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_25",
          "yarnCount": "NE 36/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_26",
          "yarnCount": "NE 36/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_27",
          "yarnCount": "NE 36/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 330,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_28",
          "yarnCount": "NE 40/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_29",
          "yarnCount": "NE 40/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_30",
          "yarnCount": "NE 40/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 345,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_31",
          "yarnCount": "NE 50/1",
          "quality": "KH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_32",
          "yarnCount": "NE 50/1",
          "quality": "CH",
          "category": "KNITTING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_33",
          "yarnCount": "NE 50/1",
          "quality": "CCH",
          "category": "KNITTING YARNS",
          "exMillPrice": 382,
          "factoryLocation": "Tamil Nadu"
        },
        {
          "id": "yarn_row_34",
          "yarnCount": "NE 16/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": 260,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_35",
          "yarnCount": "NE 16/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 261,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_36",
          "yarnCount": "NE 16/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 287,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_37",
          "yarnCount": "NE 20/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": 270,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_38",
          "yarnCount": "NE 20/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 273,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_39",
          "yarnCount": "NE 20/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 290,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_40",
          "yarnCount": "NE 24/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_41",
          "yarnCount": "NE 24/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_42",
          "yarnCount": "NE 24/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_43",
          "yarnCount": "NE 26/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_44",
          "yarnCount": "NE 26/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_45",
          "yarnCount": "NE 26/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_46",
          "yarnCount": "NE 28/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_47",
          "yarnCount": "NE 28/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_48",
          "yarnCount": "NE 28/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_49",
          "yarnCount": "NE 30/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_50",
          "yarnCount": "NE 30/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_51",
          "yarnCount": "NE 30/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_52",
          "yarnCount": "NE 32/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": 294,
          "factoryLocation": "Guntur"
        },
        {
          "id": "yarn_row_53",
          "yarnCount": "NE 32/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 300,
          "factoryLocation": "Guntur"
        },
        {
          "id": "yarn_row_54",
          "yarnCount": "NE 32/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 310,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_55",
          "yarnCount": "NE 34/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_56",
          "yarnCount": "NE 34/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_57",
          "yarnCount": "NE 34/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 316,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_58",
          "yarnCount": "NE 36/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_59",
          "yarnCount": "NE 36/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_60",
          "yarnCount": "NE 36/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 345,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_61",
          "yarnCount": "NE 40/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_62",
          "yarnCount": "NE 40/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_63",
          "yarnCount": "NE 40/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 355,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_64",
          "yarnCount": "NE 50/1",
          "quality": "KW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_65",
          "yarnCount": "NE 50/1",
          "quality": "KCW",
          "category": "WAEVING YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_66",
          "yarnCount": "NE 50/1",
          "quality": "CCW",
          "category": "WAEVING YARNS",
          "exMillPrice": 440,
          "factoryLocation": "Tamil Nadu"
        },
        {
          "id": "yarn_row_67",
          "yarnCount": "NE 16/2",
          "quality": "KW/KH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_68",
          "yarnCount": "NE 16/2",
          "quality": "KW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_69",
          "yarnCount": "NE 16/2",
          "quality": "CH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_70",
          "yarnCount": "NE 16/2",
          "quality": "CW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_71",
          "yarnCount": "NE 20/2",
          "quality": "KW/KH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 285,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_72",
          "yarnCount": "NE 20/2",
          "quality": "KW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 288,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_73",
          "yarnCount": "NE 20/2",
          "quality": "CH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 306,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_74",
          "yarnCount": "NE 20/2",
          "quality": "CW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 310,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_75",
          "yarnCount": "NE 24/2",
          "quality": "KW/KH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 295,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_76",
          "yarnCount": "NE 24/2",
          "quality": "KW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 298,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_77",
          "yarnCount": "NE 24/2",
          "quality": "CH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 320,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_78",
          "yarnCount": "NE 24/2",
          "quality": "CW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 323,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_79",
          "yarnCount": "NE 30/2",
          "quality": "KW/KH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 312,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_80",
          "yarnCount": "NE 30/2",
          "quality": "KW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 315,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_81",
          "yarnCount": "NE 30/2",
          "quality": "CH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 335,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_82",
          "yarnCount": "NE 30/2",
          "quality": "CW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 338,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_83",
          "yarnCount": "NE 32/2",
          "quality": "KW/KH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 315,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_84",
          "yarnCount": "NE 32/2",
          "quality": "KW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 318,
          "factoryLocation": "Nagpur"
        },
        {
          "id": "yarn_row_85",
          "yarnCount": "NE 32/2",
          "quality": "CH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 342,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_86",
          "yarnCount": "NE 32/2",
          "quality": "CW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 343,
          "factoryLocation": "Maharastra"
        },
        {
          "id": "yarn_row_87",
          "yarnCount": "NE 40/2",
          "quality": "KW/KH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_88",
          "yarnCount": "NE 40/2",
          "quality": "KW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": null,
          "factoryLocation": "Factory Location not available."
        },
        {
          "id": "yarn_row_89",
          "yarnCount": "NE 40/2",
          "quality": "CH SOFT TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 384,
          "factoryLocation": "Gujrat"
        },
        {
          "id": "yarn_row_90",
          "yarnCount": "NE 40/2",
          "quality": "CW HARD TWIST",
          "category": "DOUBLE YARNS",
          "exMillPrice": 391,
          "factoryLocation": "Maharastra"
        }
      ]
    },
    "fob": {
      "id": "fob",
      "name": "FOB Direct Rates",
      "description": "Factory and inland terminal direct container transport charges to Mundra/Port (₹/container)",
      "columns": [
        {
          "id": "location",
          "name": "Port / Mill Location",
          "type": "text",
          "width": 220
        },
        {
          "id": "price",
          "name": "FOB Cost (₹/container)",
          "type": "number",
          "width": 200
        }
      ],
      "rows": [
        {
          "id": "fob_row_1",
          "location": "Mundra",
          "price": 70000
        },
        {
          "id": "fob_row_2",
          "location": "North",
          "price": 125000
        },
        {
          "id": "fob_row_3",
          "location": "Maharastra",
          "price": 85000
        },
        {
          "id": "fob_row_4",
          "location": "Andhra",
          "price": 95000
        },
        {
          "id": "fob_row_5",
          "location": "TN",
          "price": 75000
        },
        {
          "id": "fob_row_6",
          "location": "Nagpur",
          "price": 125000
        },
        {
          "id": "fob_row_7",
          "location": "Pusad",
          "price": 125000
        },
        {
          "id": "fob_row_8",
          "location": "Biratnagar 15 tons",
          "price": 3000
        },
        {
          "id": "fob_row_9",
          "location": "Katmandu",
          "price": 125000
        },
        {
          "id": "fob_row_10",
          "location": "Biratnagar 23 tons",
          "price": 3500
        },
        {
          "id": "fob_row_11",
          "location": "Biratnagar 23 tons",
          "price": 3500
        },
        {
          "id": "fob_row_12",
          "location": "keytex",
          "price": 85000
        }
      ]
    },
    "freight": {
      "id": "freight",
      "name": "Ocean Freight Rates",
      "description": "Port of Discharge (POD) container rates from Mundra (USD/40' HC)",
      "columns": [
        {
          "id": "destination",
          "name": "Destination Port",
          "type": "text",
          "width": 220
        },
        {
          "id": "amount",
          "name": "Freight(USD)",
          "type": "number",
          "width": 220
        }
      ],
      "rows": [
        {
          "id": "freight_row_1",
          "destination": "AI Sokhna",
          "amount": 3600
        },
        {
          "id": "freight_row_2",
          "destination": "Buenaventura",
          "amount": 6700
        },
        {
          "id": "freight_row_3",
          "destination": "Callao",
          "amount": 6700
        },
        {
          "id": "freight_row_4",
          "destination": "Casablanca",
          "amount": 6850
        },
        {
          "id": "freight_row_5",
          "destination": "Cat Lai",
          "amount": 100
        },
        {
          "id": "freight_row_6",
          "destination": "Chittagong",
          "amount": 1150
        },
        {
          "id": "freight_row_7",
          "destination": "Colombo",
          "amount": 800
        },
        {
          "id": "freight_row_8",
          "destination": "EL DEKHILA /Alexandria",
          "amount": 5975
        },
        {
          "id": "freight_row_9",
          "destination": "Gdynia",
          "amount": 6575
        },
        {
          "id": "freight_row_10",
          "destination": "Hamburg",
          "amount": 6275
        },
        {
          "id": "freight_row_11",
          "destination": "Istanbul",
          "amount": 5775
        },
        {
          "id": "freight_row_12",
          "destination": "Lazaro Cardenas",
          "amount": 6500
        },
        {
          "id": "freight_row_13",
          "destination": "Lexious",
          "amount": 5775
        },
        {
          "id": "freight_row_14",
          "destination": "Port Louis",
          "amount": 5550
        },
        {
          "id": "freight_row_15",
          "destination": "Psair Gudang",
          "amount": 300
        },
        {
          "id": "freight_row_16",
          "destination": "Puerto quetzal",
          "amount": 6700
        },
        {
          "id": "freight_row_17",
          "destination": "Qingdao/SH",
          "amount": 100
        },
        {
          "id": "freight_row_18",
          "destination": "Tunis",
          "amount": 7050
        },
        {
          "id": "freight_row_19",
          "destination": "Wuhu",
          "amount": 300
        },
        {
          "id": "freight_row_20",
          "destination": "Santos",
          "amount": 6800
        },
        {
          "id": "freight_row_21",
          "destination": "FOB",
          "amount": 1
        }
      ]
    }
  }
};
