#include <algorithm>
#include <iostream>
#include <limits>
#include <numeric>
#include <utility>
#include <vector>

using namespace std;

using Integer = long long;
vector<Integer> path, best;

vector<int> makePrimes() {
    const int limit = 55000;
    vector<bool> composite(limit + 1);
    vector<int> primes;
    for (int x = 2; x <= limit; ++x) {
        if (composite[x]) continue;
        primes.push_back(x);
        if (x <= limit / x) {
            for (int y = x * x; y <= limit; y += x) composite[y] = true;
        }
    }
    return primes;
}

const vector<int> primes = makePrimes();

void findLargestDivisor(const vector<pair<Integer, int>>& factors, size_t pos,
                        Integer current, Integer upper, Integer a, Integer b,
                        Integer& found) {
    if (pos == factors.size()) {
        if (current > found && (current + b) % a == 0) found = current;
        return;
    }
    auto [prime, exponent] = factors[pos];
    for (int i = 0; i <= exponent; ++i) {
        findLargestDivisor(factors, pos + 1, current, upper, a, b, found);
        if (current > upper / prime) break;
        current *= prime;
    }
}

void saveSolution(Integer last) {
    path.push_back(last);
    if (best.empty() || last < best.back() || (last == best.back() && path < best)) {
        best = path;
    }
    path.pop_back();
}

void finishWithTwo(Integer a, Integer b, Integer first) {
    const Integer limit = numeric_limits<Integer>::max();
    Integer lower = max(first, b / a + 1);
    Integer upper = min((2 * b - 1) / a, best.empty() ? limit : best.back() - 1);
    if (upper < lower) return;

    if (upper - lower > 48 && b <= 3000000000LL) {
        // (a*x-b)(a*y-b)=b²，可通过枚举 b² 的因子直接找到最后两项。
        vector<pair<Integer, int>> factors;
        Integer rest = b;
        for (int prime : primes) {
            if (prime > rest / prime) break;
            if (rest % prime != 0) continue;
            int count = 0;
            do {
                rest /= prime;
                ++count;
            } while (rest % prime == 0);
            factors.push_back({prime, 2 * count});
        }
        if (rest > 1) factors.push_back({rest, 2});
        Integer divisor = 0;
        findLargestDivisor(factors, 0, 1, a * upper - b, a, b, divisor);
        if (divisor >= a * lower - b) {
            path.push_back((divisor + b) / a);
            saveSolution((b * b / divisor + b) / a);
            path.pop_back();
        }
        return;
    }

    // x 越大，能与它凑成 a/b 的 y 越小，故从大到小试 x。
    for (Integer x = upper; x >= lower; --x) {
        Integer divisor = a * x - b;
        Integer common = gcd(divisor, x);
        divisor /= common;
        if (b % divisor != 0) continue;
        Integer factor = x / common;
        Integer other = b / divisor;
        if (factor > limit / other) return;
        Integer y = factor * other;
        if (best.empty() || y <= best.back()) {
            path.push_back(x);
            saveSolution(y);
            path.pop_back();
        }
        return;
    }
}

void searchEgyptian(Integer a, Integer b, Integer first, int remaining) {
    const Integer limit = numeric_limits<Integer>::max();
    if (!best.empty() && b <= limit / remaining && a <= limit / best.back() &&
            remaining * b > a * best.back()) return;
    if (remaining == 1) {
        if (b % a == 0 && b / a >= first) saveSolution(b / a);
        return;
    }
    if (remaining == 2 && b <= limit / 2) {
        finishWithTwo(a, b, first);
        return;
    }

    // 每个后继分母都更大，剩余各项的总和必小于 remaining / d。
    Integer lower = max(first, b / a + (b % a != 0));
    for (Integer d = lower; d <= limit / a; ++d) {
        if (!best.empty() && d > best.back() - remaining + 1) break;
        if (b <= limit / remaining && a * d >= b * remaining) break;

        // 先约去 b 与 d 的公因子，再做分数减法。
        Integer common = gcd(b, d);
        Integer multiplier = d / common;
        if (b > limit / multiplier) continue;
        Integer numerator = a * multiplier - b / common;
        if (numerator <= 0) continue;
        Integer denominator = b * multiplier;
        Integer reduce = gcd(numerator, denominator);
        path.push_back(d);
        searchEgyptian(numerator / reduce, denominator / reduce, d + 1, remaining - 1);
        path.pop_back();
    }
}

int main() {
    Integer a, b;
    while (cin >> a >> b) {
        best.clear();
        Integer divisor = gcd(a, b);
        for (int terms = 1; best.empty(); ++terms) {
            searchEgyptian(a / divisor, b / divisor, 1, terms);
        }
        for (size_t i = 0; i < best.size(); ++i) {
            if (i > 0) cout << ' ';
            cout << best[i];
        }
        cout << '\n';
    }
}
