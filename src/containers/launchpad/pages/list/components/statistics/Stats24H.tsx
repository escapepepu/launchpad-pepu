import { inDesktop, Spacing } from "@boxfoxs/bds-web";
import { commaizeNumber } from "@boxfoxs/utils";
import styled from "@emotion/styled";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { LoadingLottie } from "components/lotties/LoadingLottie";
import { fetchQuote } from "hooks/on-chain/useDexPrice";
import { useEffect, useState } from "react";
import { formatDecimals } from "utils/format";
import { pressableStyle } from "utils/style";

/**
 * Stats24H Component
 * - Fetches top pools by totalValueLockedETH
 * - Looks up presale data to find iconUrl, etc.
 * - Calculates market cap, volume, and performance in “x times”
 * - Displays results with pagination
 */
const Stats24H = () => {
  // Dex price for WPEPU
  let [dexPrice, setDexPrice] = useState(0);

  // Pagination states
  let [paginationPageNumber, setPaginationPageNumber] = useState(0);
  let [loadingNewPage, setLoadingNewPage] = useState(true);

  // Final list of tokens/pools
  const [highestPriceTokensOut, setHighestPriceTokensOut] = useState([]);

  // =========================
  // 1) Fetch Dex Price
  // =========================
  useEffect(() => {
    const fetchDexPrice = async () => {
      try {
        const price = await fetchQuote();
        setDexPrice(parseFloat(price));
      } catch (err) {
        console.error("Error fetching Dex Price", err);
      }
    };
    fetchDexPrice();
  }, []);

  // =========================
  // 2) Fetch top pools after Dex price is known
  // =========================
  useEffect(() => {
    if (dexPrice === 0) return;
    fetchPoolWithHighestPrice();
  }, [dexPrice]);

  // Also refetch whenever pagination changes
  useEffect(() => {
    fetchPoolWithHighestPrice();
  }, [paginationPageNumber]);

  /**
   * fetchPoolWithHighestPrice
   * - Queries subgraph for top 50 pools by totalValueLockedETH
   * - For each pool, fetches presale data (iconUrl, etc.)
   * - Calculates marketCap, volume, xChange
   * - Updates state with final results
   */
  const fetchPoolWithHighestPrice = async () => {
    setLoadingNewPage(true);

    // Build a GraphQL query that uses skip for pagination
    const query = `
      query GetHighestPriceToken {
        pools(
          orderBy: totalValueLockedETH,
          orderDirection: desc,
          first: 50,
          skip: ${paginationPageNumber * 49}
        ) {
          id
          totalValueLockedETH
          totalValueLockedToken0
          totalValueLockedToken1
          token1 {
            name
            symbol
            id
          }
          token0 {
            name
            symbol
            id
          }
          volumeToken0
          volumeToken1
        }
      }
    `;

    // Fetch from subgraph
    const highestPriceTokenJson = await fetch(process.env.NEXT_PUBLIC_GRAPH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }).then((res) => res.json());

    // 3) Fetch presale data for these pools
    const tokenDatas = await fetchPresales(highestPriceTokenJson.data.pools);
    // console.log("tokenDatas >>>>>>>>", tokenDatas);

    // 4) Match presale data, set iconUrl/description, and compute stats
    for (let token of highestPriceTokenJson.data.pools) {
      // Attempt to find a matching presale by "id"
      const tokenData = tokenDatas.find((t) => t.id === token.id);
      if (tokenData) {
        token["iconUrl"] = tokenData.data.iconUrl;
        token["description"] = tokenData.data.description;

        // Set initial market cap that is (50 * dexPrice)
        // so we can compute "x times" from that baseline
        token["initialMarketCap"] = 50 * dexPrice;

        // Current market cap is totalValueLockedETH * dexPrice
        token["marketCap"] = parseFloat(token.totalValueLockedETH) * dexPrice;
      }
    }

    // 5) Compute volume and xChange for each pool
    for (let token of highestPriceTokenJson.data.pools) {
      // Check if token0 or token1 is WPEPU and set volume accordingly
      if (token.token0.symbol === "WPEPU") {
        token["volume"] = parseFloat(token.volumeToken0) * dexPrice;
      } else {
        token["volume"] = parseFloat(token.volumeToken1) * dexPrice;
      }

      // Calculate performance => ( (marketCap - initMC) / initMC ) * 100 => xChange
      // Then displayed as xChange/100 => “x” in the table
      if (!token.marketCap) {
        token["xChange"] = 0;
      } else {
        token["xChange"] = ((token.marketCap - token.initialMarketCap) / token.initialMarketCap) * 100;
      }
    }

    // Save final list
    setHighestPriceTokensOut(highestPriceTokenJson.data.pools);
    setLoadingNewPage(false);
  };

  /**
   * fetchPresales
   * - Given an array of pool objects, extract the token ID that’s NOT WPEPU
   * - Query subgraph for presales that match those token IDs
   * - Parse each presale’s "data" field as JSON
   * - Return array of presale objects
   */
  const fetchPresales = async (tokenObjects: any) => {
    // For each pool, decide if token0 or token1 is the "main" token
    const tokenIds = tokenObjects.map((token) => {
      if (token.token0.symbol === "WPEPU") {
        return token.token1.id;
      } else {
        return token.token0.id;
      }
    });

    const query = `
      query GetTokensData {
        presales(where: { token_in: [${tokenIds.map((id) => `"${id}"`).join(",")}] }) {
          id
          data
          name
          symbol
          token
        }
      }
    `;

    const tokensDataJson = await fetch(process.env.NEXT_PUBLIC_GRAPH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }).then((res) => res.json());

    // Every presale has a "data" field that may be JSON string => parse it
    tokensDataJson.data.presales.forEach((presale: any) => {
      presale.data = JSON.parse(presale.data);
    });

    return tokensDataJson.data.presales;
  };

  // =========================
  // RENDER
  // =========================
  return (
      <div>
        {
          /**
           * If we’re still loading data, show a spinner
           */
            loadingNewPage && (
                <>
                  <Spacing height={28} />
                  <LoadingLottie width={36} />
                  <Spacing height={28} />
                </>
            )
        }

        {
          /**
           * Once loading is done, show the table
           */
            !loadingNewPage && (
                <table style={{ width: "100%", minWidth: "748px", borderSpacing: 0 }}>
                  <thead>
                  <tr>
                    <TableHeader> Token name </TableHeader>
                    <TableHeader> Marketcap </TableHeader>
                    <TableHeader> 24h Volume </TableHeader>
                    <TableHeader> Performance </TableHeader>
                    <TableHeader> Info </TableHeader>
                  </tr>
                  </thead>
                  <tbody>
                  {
                    /**
                     * If no tokens found, just show empty row
                     */
                    !highestPriceTokensOut?.length ? (
                        <TableBodyRow style={{ height: "56px" }} />
                    ) : (
                        highestPriceTokensOut?.map((item) => {
                          return (
                              <TableBodyRow key={item.id}>
                                {/* Name column (23%) */}
                                <TableBody
                                    width={23}
                                    style={{ display: "flex", alignItems: "center", width: "100%" }}
                                >
                                  <StyledImage src={item?.iconUrl} />
                                  <p style={{ paddingLeft: "10px" }}>
                                    {item.token0.symbol !== "WPEPU" ? item.token0.name : item.token1.name}
                                  </p>
                                </TableBody>

                                {/* Marketcap column (23%) */}
                                <TableBody width={23}>
                                  {item.marketCap ? (
                                      <>
                                        $
                                        {commaizeNumber(
                                            formatDecimals(Math.abs(item.marketCap), 2)
                                        )}
                                      </>
                                  ) : (
                                      <LoadingLottie width={18} />
                                  )}
                                </TableBody>

                                {/* 24h Volume column (23%) */}
                                <TableBody width={23}>
                                  {item.volume ? (
                                      <>
                                        $
                                        {commaizeNumber(
                                            formatDecimals(Math.abs(item.volume), 2)
                                        )}
                                      </>
                                  ) : (
                                      <LoadingLottie width={18} />
                                  )}
                                </TableBody>

                                {/* Performance column (23%) => xChange/100 => “x” */}
                                <TableBody width={23}>
                                  {item.xChange !== undefined ? (
                                      <>
                                        {commaizeNumber(
                                            formatDecimals(item.xChange / 100, 2)
                                        )}
                                        x
                                      </>
                                  ) : (
                                      <LoadingLottie width={18} />
                                  )}
                                </TableBody>

                                {/* Info column (8%) => link to that token's page */}
                                <TableBody width={8}>
                                  <a
                                      href={`/${
                                          item.token0.symbol !== "WPEPU"
                                              ? item.token0.id
                                              : item.token1.id
                                      }`}
                                      rel="noreferrer"
                                  >
                                    <img
                                        src="/images/ic_expand_window.svg"
                                        alt="expand"
                                        width={14}
                                    />
                                  </a>
                                </TableBody>
                              </TableBodyRow>
                          );
                        })
                    )
                  }
                  </tbody>
                </table>
            )
        }

        {/* Pagination controls */}
        <Spacing height={8} />
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          {/* Left arrow */}
          <ScrollButtonPagination
              onClick={() => {
                let paginationNmbr = paginationPageNumber;
                if (paginationNmbr > 0) {
                  paginationNmbr = paginationNmbr - 1;
                  setPaginationPageNumber(paginationNmbr);
                }
              }}
          >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ transform: "rotateY(180deg)" }}
            >
              <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
              />
            </svg>
          </ScrollButtonPagination>

          <span style={{ fontSize: "18px", color: "#fff", margin: "0 50px" }}>
          {1 + paginationPageNumber}
        </span>

          {/* Right arrow */}
          {highestPriceTokensOut.length > 49 ? (
              <ScrollButtonPagination
                  onClick={() => {
                    let paginationNmbr = paginationPageNumber + 1;
                    setPaginationPageNumber(paginationNmbr);
                  }}
              >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                      d="M9 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                  />
                </svg>
              </ScrollButtonPagination>
          ) : (
              <></>
          )}
        </div>
      </div>
  );
};

export default Stats24H;

/* ============================
   Styled Components
   ============================ */

const TableHeader = styled.th`
  color: #fff;
  font-size: 14px;
  font-style: normal;
  font-weight: 500;
  line-height: 32px;
  text-align: left;
`;

const TableBodyRow = styled.tr`
  :last-child td {
    border-bottom: none;
  }
`;

const TableBody = styled.td<{ width?: number }>`
  padding: 16px 0;
  color: #fff;
  font-size: 15px;
  font-style: normal;
  font-weight: 400;
  line-height: 20px; /* 142.857% */
  width: ${(p) => p.width}%;
  border-bottom: 1px solid #272727;
`;

const LeftButton = styled(ChevronLeftIcon)`
  cursor: pointer;
  ${pressableStyle.opacity()}
`;

const RightButton = styled(ChevronRightIcon)`
  cursor: pointer;
  ${pressableStyle.opacity()}
`;

const StyledImage = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 2px solid #272727;
  object-fit: cover;
`;

const ScrollButtonPagination = styled.button`
  width: 30px;
  height: 30px;
  background-color: #00b300; /* Green background */
  color: #fff; /* White arrow color */
  border: 2px solid #000;
  border-radius: 50%; /* Circle shape */
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); /* Subtle shadow */
  transition: background-color 0.3s ease, box-shadow 0.3s ease;

  &:hover {
    background-color: #009900; /* Darker green on hover */
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3); /* Enhanced shadow on hover */
  }

  &:active {
    background-color: #006600; /* Even darker green on click */
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); /* Reduced shadow on click */
  }

  svg {
    width: 44px;
    height: 44px;
    color: #000;
  }

  ${inDesktop(`
    top: 50%;
  `)}
`;
