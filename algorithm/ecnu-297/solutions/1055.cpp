#include <algorithm>
#include <iostream>
#include <limits>
using namespace std;

using Cost = unsigned long long;
const Cost limit = numeric_limits<Cost>::max();

Cost add(Cost a, Cost b) {
    return a > limit - b ? limit : a + b;
}

Cost multiply(Cost a, Cost b) {
    return b && a > limit / b ? limit : a * b;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int n;
        cin >> n;
        Cost dimension[51], dp[51][51] = {};
        for (int i = 1; i <= n; ++i) cin >> dimension[i - 1] >> dimension[i];

        for (int length = 2; length <= n; ++length) {
            for (int left = 1; left + length - 1 <= n; ++left) {
                int right = left + length - 1;
                dp[left][right] = limit;
                for (int k = left; k < right; ++k) {
                    // 某个非最优方案可能超出表示范围，饱和处理防止回绕。
                    Cost product = multiply(multiply(dimension[left - 1], dimension[k]), dimension[right]);
                    Cost cost = add(add(dp[left][k], dp[k + 1][right]), product);
                    dp[left][right] = min(dp[left][right], cost);
                }
            }
        }
        cout << dp[1][n] << '\n';
    }
    return 0;
}
