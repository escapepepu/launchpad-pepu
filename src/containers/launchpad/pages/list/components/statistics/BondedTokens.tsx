import React, { useEffect, useState } from "react";
import styled from "@emotion/styled";
import { Spacing } from "@boxfoxs/bds-web";
import { commaizeNumber } from "@boxfoxs/utils";
import { formatDecimals } from "utils/format";
import { ethers } from "ethers";
import { LoadingLottie } from "components/lotties/LoadingLottie";
import { getV3BondedPrice } from "utils/getV3BondedPrice";
import { fetchQuote } from "hooks/on-chain/useDexPrice";

/**
 * List of tokens we do NOT want to display.
 */
const BLACKLIST_TOKENS = ["0x33c2643b968cf7ada40e26ad0d884b6e9aaf76c3"];

/**
 * BondedTokens component
 * - Fetches base WPEPU price (dexPrice)
 * - Queries subgraph for ended presales
 * - Calculates market cap & performance in “x times”
 * - Displays table with pagination
 */
export default function BondedTokens() {
  // Store the WPEPU dex price
  const [dexPrice, setDexPrice] = useState(0);

  // Pagination states
  const [paginationPageNumber, setPaginationPageNumber] = useState(0);
  const [loadingNewPage, setLoadingNewPage] = useState(true);

  // Final tokens to show in the table
  const [bondedTokens, setBondedTokens] = useState([]);

  // Whether there is another page after the current one
  const [hasMore, setHasMore] = useState(false);

  // =========================
  // 1) Fetch the base Dex price
  // =========================
  useEffect(() => {
    // Check PEPU price and set initial market cap
    const fetchDexPriceOnce = async () => {
      try {
        const price = await fetchQuote();
        setDexPrice(parseFloat(price));
      } catch (err) {
        console.error("Error fetching Dex Price", err);
      }
    };
    fetchDexPriceOnce();
  }, []);

  // =========================
  // 2) Fetch presales data whenever dexPrice or pagination changes
  // =========================
  useEffect(() => {
    if (!dexPrice) return;
    fetchBondedPresales();
  }, [dexPrice, paginationPageNumber]);

  /**
   * fetchBondedPresales
   * - Queries the subgraph for presales that have ended (isEnd: true)
   * - Filters out blacklisted tokens
   * - Fetches each token’s price from DEX (via getV3BondedPrice)
   * - Calculates market cap and “x times” performance
   * - Sorts by market cap desc, sets final data
   */
  const fetchBondedPresales = async () => {
    setLoadingNewPage(true);
    try {
      const query = `
        query BondedPresales {
          presales(
            where: { isEnd: true }
            first: 50
            skip: ${paginationPageNumber * 49}
          ) {
            name
            data
            token
            isEnd
            totalSupply
          }
        }
      `;

      const res = await fetch(process.env.NEXT_PUBLIC_GRAPH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();

      // Raw list of tokens from subgraph
      let tokens = json.data?.presales || [];

      // filter out blacklisted tokens
      tokens = tokens.filter((t) => !BLACKLIST_TOKENS.includes(t.token));

      // If we got 50 items, we can go to next page; otherwise we’re at the end
      setHasMore(tokens.length === 50);

      // Every presale's "data" may be a JSON string, so parse it
      tokens.forEach((t) => {
        if (typeof t.data === "string") {
          t.data = JSON.parse(t.data);
        }
      });

      // Wait for token price to be fetched from DEX
      const pricePromises = tokens.map((token) => getV3BondedPrice(token.token));
      const results = await Promise.all(pricePromises);

      // Merge the price results into each token object
      tokens = tokens.map((token, i) => {
        // Convert raw DEX price to float
        const rawPrice = results[i];
        const tokenPrice = parseFloat(ethers.utils.formatEther(rawPrice)) || 0;

        // Convert totalSupply from BigNumber => float
        const supply = parseFloat(ethers.utils.formatEther(token.totalSupply));

        // Calculate market cap
        const marketCap = supply * tokenPrice * dexPrice;

        // Hard-coded initial market cap from old code
        const initialMarketCap = 1200;

        // xChange in “percentage form,” e.g. 7300 => 73.00x
        const xChange = ((marketCap - initialMarketCap) / initialMarketCap) * 100;

        return {
          ...token,
          marketCap,
          xChange,
        };
      });

      // Sort tokens by marketCap descending
      tokens.sort((a, b) => b.marketCap - a.marketCap);

      // Update the state with final list
      setBondedTokens(tokens);
    } catch (error) {
      console.error("Error fetching bonded tokens", error);
    }
    setLoadingNewPage(false);
  };

  // =========================
  // RENDER
  // =========================
  return (
      <div>
        {loadingNewPage ? (
            <>
              <Spacing height={28} />
              <LoadingLottie width={36} />
              <Spacing height={28} />
            </>
        ) : (
            <table style={{ width: "100%", minWidth: "748px", borderSpacing: 0 }}>
              <thead>
              <tr>
                <TableHeader>Token name</TableHeader>
                <TableHeader>Marketcap</TableHeader>
                <TableHeader>Performance</TableHeader>
                <TableHeader>Info</TableHeader>
              </tr>
              </thead>
              <tbody>
              {!bondedTokens.length ? (
                  <TableBodyRow style={{ height: "56px" }} />
              ) : (
                  bondedTokens.map((item) => (
                      <TableBodyRow key={item.token}>
                        {/* Token name column (30%) */}
                        <TableBody
                            width={30}
                            style={{ display: "flex", alignItems: "center", width: "100%" }}
                        >
                          <StyledImage src={item?.data?.iconUrl} />
                          <p style={{ paddingLeft: "10px" }}>{item.name}</p>
                        </TableBody>

                        {/* Marketcap column (30%) */}
                        <TableBody width={30}>
                          {item.marketCap ? (
                              `$${commaizeNumber(
                                  formatDecimals(Math.abs(item.marketCap), 2)
                              )}`
                          ) : (
                              <LoadingLottie width={18} />
                          )}
                        </TableBody>

                        {/* Performance column (30%)
                      Here, xChange=7300 => displayed as "73.00x"
                  */}
                        <TableBody width={30}>
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

                        {/* Info column (10%) */}
                        <TableBody width={10}>
                          <a href={`/${item.token}`} rel="noreferrer">
                            <img
                                src="/images/ic_expand_window.svg"
                                alt="expand"
                                width={14}
                            />
                          </a>
                        </TableBody>
                      </TableBodyRow>
                  ))
              )}
              </tbody>
            </table>
        )}

        <Spacing height={8} />

        {/* Pagination */}
        <PaginationContainer>
          {/* Left arrow (go back) */}
          <ScrollButtonPagination
              onClick={() => {
                if (paginationPageNumber > 0) {
                  setPaginationPageNumber((prev) => prev - 1);
                }
              }}
          >
            <svg viewBox="0 0 24 24" style={{ transform: "rotateY(180deg)" }}>
              <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
              />
            </svg>
          </ScrollButtonPagination>

          {/* Current page number */}
          <span style={{ fontSize: "18px", color: "#fff", margin: "0 50px" }}>
          {paginationPageNumber + 1}
        </span>

          {/* Right arrow (go forward) */}
          {hasMore && (
              <ScrollButtonPagination
                  onClick={() => setPaginationPageNumber((prev) => prev + 1)}
              >
                <svg viewBox="0 0 24 24">
                  <path
                      d="M9 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                  />
                </svg>
              </ScrollButtonPagination>
          )}
        </PaginationContainer>
      </div>
  );
}

/* =======================
   Styled Components
   ======================= */
const TableHeader = styled.th`
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    line-height: 32px;
    text-align: left;
`;

const TableBodyRow = styled.tr`
    :last-child td {
        border-bottom: none;
    }
`;

/**
 * Accepts an optional { width?: number } prop so
 * you can do <TableBody width={30}> => 30% width
 */
const TableBody = styled.td<{ width?: number }>`
  padding: 16px 0;
  color: #fff;
  font-size: 15px;
  font-weight: 400;
  line-height: 20px;
  border-bottom: 1px solid #272727;
  width: ${(p) => p.width}%;
`;

const StyledImage = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 2px solid #272727;
  object-fit: cover;
`;

const PaginationContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const ScrollButtonPagination = styled.button`
  width: 30px;
  height: 30px;
  border: 2px solid #000;
  border-radius: 50%;
  background-color: #00b300;
  color: #fff;
  cursor: pointer;
  transition: background-color 0.3s ease;

  svg {
    width: 28px;
    height: 28px;
  }

  &:hover {
    background-color: #009900;
  }

  &:active {
    background-color: #006600;
  }
`;
