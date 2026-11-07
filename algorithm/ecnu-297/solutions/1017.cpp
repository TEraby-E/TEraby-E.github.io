#include <iostream>
#include <vector>
using namespace std;

long long countPairs(vector<long long> &a, vector<long long> &temp, int left, int right) {
    if (right - left <= 1) return 0;
    int mid = left + (right - left) / 2;
    long long count = countPairs(a, temp, left, mid) + countPairs(a, temp, mid, right);
    int i = left, j = mid, k = left;
    while (i < mid && j < right) {
        if (a[i] <= a[j]) {
            temp[k++] = a[i++];
        } else {
            // 左半区从 i 到 mid-1 都大于当前的 a[j]。
            count += mid - i;
            temp[k++] = a[j++];
        }
    }
    while (i < mid) temp[k++] = a[i++];
    while (j < right) temp[k++] = a[j++];
    for (int p = left; p < right; ++p) a[p] = temp[p];
    return count;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> a(n), temp(n);
    for (long long &x : a) cin >> x;
    cout << countPairs(a, temp, 0, n) << '\n';
}
