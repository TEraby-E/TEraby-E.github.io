#include <iostream>
using namespace std;

int main() {
    int dp[21][3] = {};
    dp[0][0] = 1;
    for (int i = 1; i <= 20; ++i) {
        // 状态 0、1、2 分别表示最长后缀与禁串前缀匹配了 0、1、2 位。
        dp[i][0] = dp[i - 1][0] + dp[i - 1][2];
        dp[i][1] = dp[i - 1][0] + dp[i - 1][1];
        dp[i][2] = dp[i - 1][1];
        // 状态 2 接 1 会组成 101，因此舍弃。
    }
    int n;
    while (cin >> n && n != -1)
        cout << dp[n][0] + dp[n][1] + dp[n][2] << '\n';
    return 0;
}
