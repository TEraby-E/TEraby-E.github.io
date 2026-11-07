#include <algorithm>
#include <iostream>
using namespace std;

const int states = 8192;
const int mod = 1000000007;
int frequency[4501], dp[states], nextDp[states];
bool composite[states];

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    for (int i = 0; i < n; ++i) {
        int value;
        cin >> value;
        ++frequency[value];
    }

    dp[0] = 1;
    for (int value = 3500; value <= 4500; ++value) {
        int count = frequency[value];
        if (count == 0) continue;
        // 同值元素按取了几个计数。取偶数个不改变异或值，取奇数个异或 value。
        int even = count / 2 + 1;
        int odd = (count + 1) / 2;
        for (int x = 0; x < states; ++x)
            nextDp[x] = (1LL * even * dp[x] + 1LL * odd * dp[x ^ value]) % mod;
        copy(nextDp, nextDp + states, dp);
    }

    int answer = 0;
    for (int p = 2; p < states; ++p) {
        if (composite[p]) continue;
        answer = (answer + dp[p]) % mod;
        for (int j = p * p; j < states; j += p) composite[j] = true;
    }
    cout << answer << '\n';
    return 0;
}
