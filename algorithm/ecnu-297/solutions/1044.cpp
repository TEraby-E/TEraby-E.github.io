#include <algorithm>
#include <iostream>
#include <numeric>
#include <vector>

using namespace std;

const int LIMIT = 20000000;
vector<int> a;
vector<long long> prefix;

int countSubsets(int start, long long budget) {
    int n = static_cast<int>(a.size());
    int remaining = n - start;
    int window = min(remaining, 25);
    if (prefix[start + window] - prefix[start] <= budget) {
        if (remaining == window || window == 25) {
            return window == 25 ? LIMIT + 1 : 1 << window;
        }
    }

    int answer = 1;  // 后面的元素全部不选。
    for (int i = start; i < n && a[i] <= budget; ++i) {
        answer += countSubsets(i + 1, budget - a[i]);
        if (answer > LIMIT) return LIMIT + 1;
    }
    return answer;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    long long k;
    if (!(cin >> n >> k)) return 0;
    a.resize(n);
    for (int& x : a) cin >> x;
    sort(a.begin(), a.end());
    prefix.resize(n + 1);
    for (int i = 0; i < n; ++i) prefix[i + 1] = prefix[i] + a[i];

    // 选中元素之和 > k，等价于未选元素之和 <= 总和 - k - 1。
    long long budget = prefix[n] - k - 1;
    int answer = budget < 0 ? 0 : countSubsets(0, budget);
    cout << (answer > LIMIT ? -1 : answer) << '\n';
}
