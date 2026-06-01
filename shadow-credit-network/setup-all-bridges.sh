#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# The frontend bridge on Arbitrum Sepolia — this is where scores originate
ARB_BRIDGE="0x2624B23580Ce69D32CF9911AdFDd4D28324C10FB"

# Source the frontend .env for VITE vars (so configure-bridge picks them up)
export $(grep -v '^#' frontend/.env | xargs)

echo "══════════════════════════════════════════════════"
echo "  Shadow Credit Network — Multi-Chain Bridge Setup"
echo "══════════════════════════════════════════════════"
echo ""

# ── 1. Deploy bridges on all destination chains ──────
NETWORKS=(
  "eth-sepolia"
  "base-sepolia"
  "optimism-sepolia"
  "polygon-amoy"
  "avalanche-fuji"
  "bnb-testnet"
  "helium"
)

echo "──────────────────────────────────────────────"
echo "  Phase 1: Deploy CrossChainCreditBridge"
echo "──────────────────────────────────────────────"
for net in "${NETWORKS[@]}"; do
  echo ""
  echo "═══ Deploying on $net ═══"
  npx hardhat deploy-bridge --network "$net" 2>&1 || echo "  ⚠  Failed — check balance & RPC"
done

# ── 2. Read all bridge addresses from deployments ────
declare -A BRIDGES
BRIDGES["arb-sepolia"]="$ARB_BRIDGE"

for net in "${NETWORKS[@]}"; do
  dep_file="deployments/${net}.json"
  if [ -f "$dep_file" ]; then
    addr=$(python3 -c "import json; print(json.load(open('$dep_file')).get('CrossChainCreditBridge', ''))" 2>/dev/null || true)
    if [ -n "$addr" ]; then
      BRIDGES["$net"]="$addr"
      echo "  $net → $addr"
    fi
  fi
done

echo ""
echo "──────────────────────────────────────────────"
echo "  Phase 2: Configure Trusted Remotes"
echo "──────────────────────────────────────────────"

# LZ EID mapping
declare -A EIDS
EIDS["arb-sepolia"]=40231
EIDS["eth-sepolia"]=40161
EIDS["base-sepolia"]=40232
EIDS["optimism-sepolia"]=40245
EIDS["polygon-amoy"]=40168
EIDS["avalanche-fuji"]=40216
EIDS["bnb-testnet"]=40273
EIDS["helium"]=40280

# ── 2a. Configure arb-sepolia bridge to trust all destinations ──
echo ""
echo "═══ Configuring arb-sepolia → all destinations ═══"
for net in "${NETWORKS[@]}"; do
  dst_addr="${BRIDGES[$net]:-}"
  if [ -z "$dst_addr" ]; then
    echo "  ⚠  No bridge for $net — skipping"
    continue
  fi
  echo "  → Setting trusted remote for EID ${EIDS[$net]} ($net)..."
  npx hardhat configure-bridge \
    --network arb-sepolia \
    --bridge "$ARB_BRIDGE" \
    --dsteid "${EIDS[$net]}" \
    --remote "$dst_addr" 2>&1 || echo "  ⚠  Failed"
done

# ── 2b. Configure each destination bridge to trust arb-sepolia ──
echo ""
echo "═══ Configuring destinations → arb-sepolia ═══"
for net in "${NETWORKS[@]}"; do
  src_addr="${BRIDGES[$net]:-}"
  if [ -z "$src_addr" ]; then
    continue
  fi
  echo "  → Setting trusted remote on $net for arb-sepolia..."
  npx hardhat configure-bridge \
    --network "$net" \
    --bridge "$src_addr" \
    --dsteid "${EIDS[arb-sepolia]}" \
    --remote "$ARB_BRIDGE" 2>&1 || echo "  ⚠  Failed"
done

# ── 2c. Configure cross-destination pairs (optional, for full mesh) ──
echo ""
echo "═══ Configuring cross-destination pairs ═══"
for src_net in "${NETWORKS[@]}"; do
  src_addr="${BRIDGES[$src_net]:-}"
  [ -z "$src_addr" ] && continue
  for dst_net in "${NETWORKS[@]}"; do
    [ "$src_net" = "$dst_net" ] && continue
    dst_addr="${BRIDGES[$dst_net]:-}"
    [ -z "$dst_addr" ] && continue
    echo "  → $src_net → $dst_net (EID ${EIDS[$dst_net]})..."
    npx hardhat configure-bridge \
      --network "$src_net" \
      --bridge "$src_addr" \
      --dsteid "${EIDS[$dst_net]}" \
      --remote "$dst_addr" 2>&1 || echo "  ⚠  Failed"
  done
done

echo ""
echo "══════════════════════════════════════════════════"
echo "  Setup Complete!"
echo "══════════════════════════════════════════════════"
echo ""
echo "Bridge addresses:"
for net in "${!BRIDGES[@]}"; do
  printf "  %-20s %s\n" "$net" "${BRIDGES[$net]}"
done
echo ""
echo "Update frontend/.env with all addresses to enable lookups."
