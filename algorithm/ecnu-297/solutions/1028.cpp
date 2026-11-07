#include <algorithm>
#include <iostream>
#include <vector>

using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    long long operations;
    if (!(cin >> n >> operations)) return 0;
    vector<long long> a(n);
    for (long long& x : a) cin >> x;
    sort(a.begin(), a.end());

    // 把最小的一组数一起抬升，避免逐次分配加一操作。
    int count = 1;
    long long level = a[0];
    while (count < n) {
        long long needed = (a[count] - level) * count;
        if (needed > operations) break;
        operations -= needed;
        level = a[count++];
    }

    const long long MOD = 1000000007;
    level += operations / count;
    int extra = static_cast<int>(operations % count);
    long long answer = 1;
    for (int i = 0; i < n; ++i) {
        long long value = i < count ? level + (i < extra) : a[i];
        answer = answer * (value % MOD) % MOD;
    }
    cout << answer << '\n';
}
