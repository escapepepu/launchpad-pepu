import React, { useEffect, useState } from "react";
import styled from "@emotion/styled";
import { Spacing } from "@boxfoxs/bds-web";
import { commaizeNumber } from "@boxfoxs/utils";
import { formatDecimals } from "utils/format";
import { ethers } from "ethers";
import { LoadingLottie } from "components/lotties/LoadingLottie";
import { inDesktop } from "@boxfoxs/bds-web";
import { getV3BondedPrice } from "utils/getV3BondedPrice";
import { fetchQuote } from "hooks/on-chain/useDexPrice";

// Same blacklist
const BLACKLIST_TOKENS = ["0x33c2643b968cf7ada40e26ad0d884b6e9aaf76c3"];

export default function BondedTokens() {
  const [dexPrice, setDexPrice] = useState(0);
  const [paginationPageNumber, setPaginationPageNumber] = useState(0);
  const [loadingNewPage, setLoadingNewPage] = useState(true);
  const [bondedTokens, setBondedTokens] = useState([]);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    // Fetch the base WPEPU price once
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

  useEffect(() => {
    if (!dexPrice) return;
    fetchBondedPresales();
  }, [dexPrice, paginationPageNumber]);

  const fetchBondedPresales = async () => {
    setLoadingNewPage(true);
    try {
      // Graph query
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

      let tokens = json.data?.presales || [];

      // Filter out blacklisted tokens
      tokens = tokens.filter((t) => !BLACKLIST_TOKENS.includes(t.token));

      // If we got 50 items, we can go to next page; otherwise we’re at the end
      setHasMore(tokens.length === 50);

      // Parse each token's "data" field if needed
      tokens.forEach((t) => {
        if (typeof t.data === "string") {
          t.data = JSON.parse(t.data);
        }
      });

      // Fetch price from getV3BondedPrice for each token
      const pricePromises = tokens.map((token) => getV3BondedPrice(token.token));
      const results = await Promise.all(pricePromises);

      // Merge prices into tokens
      tokens = tokens.map((token, i) => {
        const rawPrice = results[i];
        const tokenPrice = parseFloat(ethers.utils.formatEther(rawPrice)) || 0;
        const supply = parseFloat(ethers.utils.formatEther(token.totalSupply));
        const marketCap = supply * tokenPrice * dexPrice;

        // If you want the same "x times" approach:
        // (the old code used a fixed initial MC = 1200)
        const initialMarketCap = 1200;
        const xChange = ((marketCap - initialMarketCap) / initialMarketCap) * 100;
        // That means if marketCap is 89,000 =>
        // xChange ~ 7300 => "73.0x" when dividing by 100 in the table

        return {
          ...token,
          tokenPrice,
          marketCap,
          xChange,
        };
      });

      // Sort by marketCap descending
      tokens.sort((a, b) => b.marketCap - a.marketCap);

      setBondedTokens(tokens);
    } catch (error) {
      console.error("Error fetching bonded tokens", error);
    }
    setLoadingNewPage(false);
  };

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
                        {/* Name column (30%) */}
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
                              `$${commaizeNumber(formatDecimals(Math.abs(item.marketCap), 2))}`
                          ) : (
                              <LoadingLottie width={18} />
                          )}
                        </TableBody>

                        {/* Performance column (30%)
                      We do (xChange / 100) + "x"
                      e.g. xChange=7300 => "73.00x"
                  */}
                        <TableBody width={30}>
                          {item.xChange !== undefined ? (
                              <>
                                {commaizeNumber(formatDecimals(item.xChange / 100, 2))}x
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
        <PaginationContainer>
          {/* Left arrow */}
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

          <span style={{ fontSize: "18px", color: "#fff", margin: "0 50px" }}>
          {paginationPageNumber + 1}
        </span>

          {/* Right arrow */}
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

/* ======== Styled Components ======== */

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
