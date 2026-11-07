#include <algorithm>
#include <iostream>
#include <map>
#include <vector>

using namespace std;

long long countWays(long long n, const vector<long long>& fib, map<long long, long long>& memo) {
    if (n <= 0) return n == 0 ? 1 : 0;
    auto known = memo.find(n);
    if (known != memo.end()) return known->second;

    auto next = upper_bound(fib.begin(), fib.end(), n);
    long long largest = *(next - 1);
    // 不取最大项时，对更小的项取补集。它们的总和是下一项减 2。
    long long answer = countWays(n - largest, fib, memo)
                     + countWays(*next - 2 - n, fib, memo);
    memo.emplace(n, answer);
    return answer;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    vector<long long> fib{1, 2};
    while (fib.back() <= 1000000000000000000LL) {
        fib.push_back(fib.back() + fib[fib.size() - 2]);
    }
    int tests;
    if (!(cin >> tests)) return 0;
    for (int i = 0; i < tests; ++i) {
        long long n;
        cin >> n;
        map<long long, long long> memo;
        cout << "case #" << i << ":\n" << countWays(n, fib, memo) << '\n';
    }
}
