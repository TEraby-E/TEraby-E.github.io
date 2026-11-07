#include <algorithm>
#include <iostream>
#include <vector>

using namespace std;

int extendIncreasing(vector<int>& tails, int x) {
    auto pos = lower_bound(tails.begin(), tails.end(), x);
    int length = static_cast<int>(pos - tails.begin()) + 1;
    if (pos == tails.end()) tails.push_back(x);
    else *pos = x;
    return length;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    if (!(cin >> n)) return 0;
    vector<int> a(n), up(n), tails;
    tails.reserve(n);
    for (int& x : a) cin >> x;

    for (int i = 0; i < n; ++i) up[i] = extendIncreasing(tails, a[i]);
    tails.clear();
    int answer = 0;
    for (int i = n - 1; i >= 0; --i) {
        int down = extendIncreasing(tails, a[i]);
        answer = max(answer, up[i] + down - 1);
    }
    cout << answer << '\n';
}
