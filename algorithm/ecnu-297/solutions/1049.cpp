#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> a(n);
    long long offset = 0;
    for (int i = 1; i <= n; ++i) {
        if (i >= 2) offset += i;
        cin >> a[i - 1];
        a[i - 1] -= offset;
    }

    // 转化为使所有项等于同一个数，中位数使绝对偏差之和最小。
    sort(a.begin(), a.end());
    long long median = a[n / 2];
    long long answer = 0;
    for (long long x : a) answer += abs(x - median);
    cout << answer << '\n';
    return 0;
}
