#include <algorithm>
#include <iostream>
using namespace std;

const long long INF = 1LL << 60;
long long cost[301][302], dp[301][301];

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int cases;
    if (!(cin >> cases)) return 0;
    for (int tc = 0; tc < cases; ++tc) {
        int n, m, k;
        cin >> n >> m >> k;
        for (int r = 1; r <= n; ++r) fill(cost[r], cost[r] + r + 1, INF);
        for (int i = 0; i < m; ++i) {
            int l, r;
            long long w;
            cin >> l >> r >> w;
            cost[r][l] = min(cost[r][l], w);
        }

        // dp[r][j]：只用右端点不超过 r 的区间，至少覆盖 j 个点。
        fill(dp[0] + 1, dp[0] + k + 1, INF);
        for (int r = 1; r <= n; ++r) {
            for (int l = 1; l <= r; ++l)
                cost[r][l] = min(cost[r][l], cost[r][l - 1]);

            copy(dp[r - 1], dp[r - 1] + k + 1, dp[r]);
            for (int p = 0; p < r; ++p) {
                long long w = cost[r][p + 1];
                if (w == INF) continue;
                int added = r - p;
                // 左端点不超过 p+1，就一定能补上 p+1 到 r 的点。
                for (int j = 1; j <= min(k, r); ++j)
                    dp[r][j] = min(dp[r][j], w + dp[p][max(0, j - added)]);
            }
        }

        cout << "case #" << tc << ":\n";
        cout << (dp[n][k] == INF ? -1 : dp[n][k]) << '\n';
    }
    return 0;
}
