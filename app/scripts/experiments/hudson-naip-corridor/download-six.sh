#!/usr/bin/env bash
set -euo pipefail
base='https://coastalimagery.blob.core.windows.net/digitalcoast/NY_NAIP_2022_9986'
cd "$(dirname "$0")/source"
fetch_verify() {
  local name="$1" expected="$2" url="$3"
  if [[ -s "$name" ]] && echo "$expected  $name" | sha256sum --check --status; then
    echo "verified existing $name"
    return
  fi
  rm -f "$name.part"
  curl -L --fail --show-error --retry 3 --retry-delay 2 "$url" -o "$name.part"
  echo "$expected  $name.part" | sha256sum --check
  mv "$name.part" "$name"
}
fetch_verify tileindex_NY_NAIP_2022.zip 95fb188aadd8c9729e46f0769f4f336af02db75436c88840a744d5700854c9e1 "$base/tileindex_NY_NAIP_2022.zip"
declare -A sha=(
  [m_4107333_nw_18_060_20221022.tif]=7fc43341d40f90ede24b9f02fa49dcd675abd3f2b2bdc7f36a54ba7ccb38d89d
  [m_4107333_se_18_060_20221022.tif]=b997db585af31b29f2277340f266265b7c3e5ce287580bc327662381f191cc50
  [m_4107333_sw_18_060_20221022.tif]=512307c7db74ec30f5b1d75d11785883c34fff48e60c215683331e691d80485c
  [m_4107341_nw_18_060_20221022.tif]=c4510afef6fcac39f629aa2c7d1da628761444d086c47c93a9afe0bbdf7372e1
  [m_4107341_se_18_060_20221022.tif]=8c35fc499c0eec831baec91c1c03edf21f7f8dad4ca50b07076c997cb67a3bb1
  [m_4107341_sw_18_060_20221022.tif]=c2ea5728e582e17f56f10f86cd8bba1ee71446a12e18207e93e1b941f3d3eb39
)
for name in \
  m_4107333_nw_18_060_20221022.tif \
  m_4107333_se_18_060_20221022.tif \
  m_4107333_sw_18_060_20221022.tif \
  m_4107341_nw_18_060_20221022.tif \
  m_4107341_se_18_060_20221022.tif \
  m_4107341_sw_18_060_20221022.tif; do
  fetch_verify "$name" "${sha[$name]}" "$base/$name"
done
