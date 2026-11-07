#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

long long bestInterval(const vector<long long> &a, int left, int right) {
    if (left == right) return a[left];
    int mid = left + (right - left) / 2;
    long long best = max(bestInterval(a, left, mid), bestInterval(a, mid + 1, right));
    int i = mid, j = mid + 1;
    long long smallest = min(a[i], a[j]);
    best = max(best, 2 * smallest);
    while (i > left || j < right) {
        // 跨中点的区间每次优先并入较大的邻项，尽可能晚地降低最小值。
        if (j == right || (i > left && a[i - 1] >= a[j + 1])) {
            smallest = min(smallest, a[--i]);
        } else {
            smallest = min(smallest, a[++j]);
        }
        best = max(best, smallest * (j - i + 1));
    }
    return best;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> a(n);
    for (long long &x : a) cin >> x;
    cout << bestInterval(a, 0, n - 1) << '\n';
}
