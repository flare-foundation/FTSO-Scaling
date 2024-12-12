wget "https://raw.githubusercontent.com/TowoLabs/ftso-signal-providers/next/bifrost-wallet.providerlist.json"
mkdir -p listed-data-providers
rm -f listed-data-providers/bifrost-wallet.providerlist.json
mv bifrost-wallet.providerlist.json listed-data-providers/bifrost-wallet.providerlist.json