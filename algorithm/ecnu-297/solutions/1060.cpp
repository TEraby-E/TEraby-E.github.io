#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int n, capacity;
        cin >> n >> capacity;
        vector<int> dp(capacity + 1);
        for (int i = 0; i < n; ++i) {
            int weight, value;
            cin >> weight >> value;
            // 逆序更新，保证转移使用的是尚未加入当前物品的状态。
            for (int j = capacity; j >= weight; --j)
                dp[j] = max(dp[j], dp[j - weight] + value);
        }
        cout << dp[capacity] << '\n';
    }
    return 0;
}
